"""디자인 세션 골격 — 턴 seq 직렬화·recraft 카운터·finalize 쿼터·generate 과금."""

import asyncio
import base64
import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
import respx
from api.config import Settings
from api.domains.auth.rate_limit import AuthRateLimiter
from api.domains.design.router import (
    KNOWN_WEAVES,
    MAX_DESIGN_JSON_BYTES,
    MAX_DESIGN_PROMPT_LENGTH,
    SIGNED_INT64_MAX,
    SIGNED_INT64_MIN,
)
from api.domains.tokens import ledger
from api.errors import UpstreamError, WorkerRequestError
from api.integrations.gcs import DryRunGcsClient, GcsObjectMetadata, public_asset_url
from api.integrations.tasks import DryRunTaskQueue
from db.models.design import (
    FINALIZE_CANCELED_MESSAGE,
    FINALIZE_STALE_MESSAGE,
    DesignSession,
    DesignSessionTurn,
    DesignTurnAttachment,
    GenerationJob,
    UserMotif,
)
from db.models.images import Image
from db.models.seamless import Motif
from db.models.tokens import DesignToken
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from .factories import auth_headers, make_token_refund_claim, make_user, seed_setting

_WORKER_FABRIC_ASSETS = Path(__file__).parents[2] / "worker/src/worker/render/assets/fabric"

TOKEN_COST = ("design_token_cost_openai_render_standard", "5")
FINALIZE_LIMIT_KEY = "design_finalize_daily_limit"


def _motif_intent(motif_id: str) -> dict[str, object]:
    return {
        "intent_version": 1,
        "canvas": {"tile_mm": 24, "dpi": 300},
        "palette": {"slots": []},
        "colorways": [],
        "layers": [
            {
                "id": "private-motif",
                "type": "motif",
                "z_order": 0,
                "params": {"motif_id": motif_id},
            }
        ],
    }


async def _fund(db_session, user, amount=30):
    """generate 과금 전제 — 비용 설정 + 잔액 지급."""
    await seed_setting(db_session, *TOKEN_COST)
    db_session.add(DesignToken(user_id=user.id, amount=amount, type="grant", token_class="free"))
    await db_session.commit()


async def _seed_finalize_limit(db_session, limit=10):
    """finalize 생성 전제 — 24시간 쿼터 한도 설정 (TRUNCATE로 마이그레이션 시드가 안 남는다)."""
    await seed_setting(db_session, FINALIZE_LIMIT_KEY, str(limit))
    await db_session.commit()


class FakeWorker:
    def __init__(self):
        self.generate_payloads = []
        self.finalize_jobs = []
        self.export_payloads = []
        self.motif_import_payloads = []
        self.palette_extract_payloads = []
        self.text_preview_payloads = []
        self.photo_preview_payloads = []
        self.idea_payloads = []

    async def generate(self, payload):
        self.generate_payloads.append(payload)
        resolved_intent = payload.get("intent") or {
            "canvas": {"tile_mm": 24},
            "layers": [],
            "palette": {"slots": []},
            "colorways": [],
        }
        return {
            "generation_log_id": "11111111-1111-4111-8111-111111111111",
            "request_id": "rid-worker",
            "registry_version": "0.1.0",
            "engine_version": "0.1.0",
            "intents": [resolved_intent],
            "warnings": [],
            "candidates": [
                {
                    "id": "cand-1",
                    "design_index": 0,
                    "layout_id": "layout-1",
                    "source_fidelity": "vector",
                    "colorway_id": "default",
                    "seed": 7,
                    "svg": "<svg/>",
                    "png_object_key": "previews/rid-worker/cand-1.png",
                }
            ],
        }

    async def finalize_job(self, job_id):
        self.finalize_jobs.append(job_id)
        return {"status": "succeeded"}

    async def export(self, payload):
        self.export_payloads.append(payload)
        return b"png-bytes", "image/png"

    async def motif_import(self, payload):
        self.motif_import_payloads.append(payload)
        return {
            "motif_id": "upload-a1b2c3d4e5f6",
            "symbol": (
                '<symbol id="motif-upload-a1b2c3d4e5f6" viewBox="-0.5 -0.5 1 1">'
                '<circle cx="0" cy="0" r="0.4" fill="currentColor"/></symbol>'
            ),
            "color_slots": ["s0"],
            "bbox": [-0.5, -0.5, 0.5, 0.5],
            "anchor": [0, 0],
            "preview_svg": "<svg/>",
        }

    async def palette_extract(self, payload):
        self.palette_extract_payloads.append(payload)
        return {"colors": ["#123456", "#ABCDEF", "#FEDCBA"]}

    async def motif_text_preview(self, payload):
        self.text_preview_payloads.append(payload)
        return {"svg": '<svg viewBox="0 0 1 1"><path d="M0 0H1V1Z"/></svg>'}

    async def motif_photo_preview(self, payload):
        self.photo_preview_payloads.append(payload)
        return {
            "svg": '<svg viewBox="0 0 1 1"><path d="M0 0H1V1Z"/></svg>',
            "warnings": [],
            "background_confidence": 0.9,
            "processed_preview_base64": base64.b64encode(b"\x89PNG\r\n\x1a\npreview").decode(),
        }

    async def ideas(self, payload):
        self.idea_payloads.append(payload)
        return {"ideas": [f"아이디어 {index}" for index in range(1, payload["count"] + 1)]}

    async def aclose(self):
        pass


class FailingTaskQueue:
    capability_mode = "real"

    async def enqueue_finalize(self, job_id: uuid.UUID) -> str | None:
        raise RuntimeError("queue unavailable")


class ClaimedThenAmbiguousTaskQueue:
    capability_mode = "real"

    def __init__(self, sessionmaker):
        self._sessionmaker = sessionmaker

    async def enqueue_finalize(self, job_id: uuid.UUID) -> str | None:
        # Cloud Tasks create는 성공했고 worker가 이미 claim했지만 create 응답만 유실된 상황.
        async with self._sessionmaker() as session:
            await session.execute(
                update(GenerationJob)
                .where(GenerationJob.id == job_id, GenerationJob.status == "queued")
                .values(status="processing", attempts=GenerationJob.attempts + 1)
            )
            await session.commit()
        raise TimeoutError("response lost after task was claimed")


async def test_session_lifecycle_and_turns(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)

    session = (await client.post("/design/sessions", headers=headers)).json()
    assert session["status"] == "active"
    assert session["recraft_used"] == 0
    # 계정 쿼터는 단건 GET 전용 — 생성/목록 응답과 설정 부재 시에는 null
    assert session["finalize_quota"] is None

    sid = session["id"]
    turn1 = await client.post(
        f"/design/sessions/{sid}/turns",
        json={"role": "user", "payload": {"prompt": "잔잔한 페이즐리"}},
        headers=headers,
    )
    turn2 = await client.post(
        f"/design/sessions/{sid}/turns",
        json={"role": "assistant", "payload": {"candidates": []}},
        headers=headers,
    )
    assert turn1.json()["seq"] == 1 and turn2.json()["seq"] == 2

    turns = (await client.get(f"/design/sessions/{sid}/turns", headers=headers)).json()
    assert [t["seq"] for t in turns] == [1, 2]

    updated = await client.patch(
        f"/design/sessions/{sid}",
        json={"seed": 42, "colorway": "navy"},
        headers=headers,
    )
    assert updated.json()["seed"] == 42


async def test_session_list_returns_last_prompt(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)

    with_prompt = (await client.post("/design/sessions", headers=headers)).json()
    without_prompt = (await client.post("/design/sessions", headers=headers)).json()

    sid = with_prompt["id"]
    payloads = [
        {"type": "generate_request", "mode": "prompt", "prompt": "잔잔한 페이즐리"},
        {"type": "generate", "response": {}},
        {"type": "generate_request", "mode": "prompt", "prompt": "네이비 스트라이프"},
        # variation 턴은 prompt가 null — last_prompt 계산에서 건너뛴다
        {"type": "generate_request", "mode": "variation", "prompt": None},
    ]
    for payload in payloads:
        response = await client.post(
            f"/design/sessions/{sid}/turns",
            json={"role": "user", "payload": payload},
            headers=headers,
        )
        assert response.status_code == 201

    sessions = (await client.get("/design/sessions", headers=headers)).json()
    by_id = {s["id"]: s for s in sessions}
    assert by_id[sid]["last_prompt"] == "네이비 스트라이프"
    assert by_id[without_prompt["id"]]["last_prompt"] is None


async def test_generate_and_finalize_job(client, app, db_session, settings):
    app.state.worker = FakeWorker()
    user = await make_user(db_session)
    await _fund(db_session, user)
    await _seed_finalize_limit(db_session)
    headers = auth_headers(user, settings)
    design_session = (await client.post("/design/sessions", headers=headers)).json()
    intent_path = Path(__file__).parents[2] / "worker/tests/golden/json/01_background_solid.json"
    intent = json.loads(intent_path.read_text())

    generated = await client.post(
        "/design/generate",
        json={
            "session_id": design_session["id"],
            "intent": intent,
            "seed": 7,
            "candidate_count": 1,
        },
        headers=headers,
    )
    assert generated.status_code == 200
    assert generated.json()["candidates"][0]["id"] == "cand-1"

    turns = (
        await client.get(f"/design/sessions/{design_session['id']}/turns", headers=headers)
    ).json()
    assert turns[-2]["payload"] == {
        "type": "generate_request",
        "mode": "variation",
        "prompt": None,
        "seed": 7,
        "colorway": None,
        "candidate_count": 1,
        "palette": {"mode": "auto", "colors": []},
        "pattern_constraints": {
            "motif_scale": "auto",
            "density": "auto",
            "arrangement": "auto",
            "direction": "auto",
        },
    }
    assert turns[-1]["payload"]["type"] == "generate"
    assert turns[-1]["payload"]["response"]["intents"] == [intent]

    job = await client.post(
        f"/design/sessions/{design_session['id']}/finalize",
        json={"dpi": 300},
        headers=headers,
    )
    assert job.status_code == 201
    assert job.json()["status"] == "queued"

    fetched = await client.get(f"/design/jobs/{job.json()['id']}", headers=headers)
    assert fetched.json()["kind"] == "finalize"


async def test_generate_passes_owned_photo_and_svg_and_preserves_turn_attachments(
    client, app, db_session, settings, monkeypatch
):
    worker = FakeWorker()
    app.state.worker = worker
    user = await make_user(db_session)
    await _fund(db_session, user)
    headers = auth_headers(user, settings)
    design_session = (await client.post("/design/sessions", headers=headers)).json()
    now = datetime.now(UTC)
    photo = Image(
        object_key="uploads/design_reference/reference.png",
        entity_type="design_reference_upload",
        entity_id="uploads/design_reference/reference.png",
        uploaded_by=user.id,
        content_type="image/png",
        size_bytes=123,
        original_filename="참고.png",
        upload_completed_at=now,
        expires_at=now + timedelta(hours=1),
    )
    second_photo = Image(
        object_key="uploads/design_reference/second.webp",
        entity_type="design_reference_upload",
        entity_id="uploads/design_reference/second.webp",
        uploaded_by=user.id,
        content_type="image/webp",
        size_bytes=456,
        original_filename="구도.webp",
        upload_completed_at=now,
        expires_at=now + timedelta(hours=1),
    )
    motif = Motif(
        id="upload-a1b2c3d4e5f6",
        symbol=(
            '<symbol id="motif-upload-a1b2c3d4e5f6" viewBox="-0.5 -0.5 1 1">'
            '<circle cx="0" cy="0" r="0.4" fill="currentColor"/></symbol>'
        ),
        bbox=[-0.5, -0.5, 0.5, 0.5],
        anchor=[0, 0],
        source="user_upload",
    )
    db_session.add_all([photo, second_photo, motif])
    await db_session.flush()
    user_motif = UserMotif(user_id=user.id, motif_id=motif.id, name="내 원형")
    db_session.add(user_motif)
    await db_session.commit()
    await db_session.refresh(photo)
    await db_session.refresh(user_motif)

    generated = await client.post(
        "/design/generate",
        json={
            "session_id": design_session["id"],
            "prompt": "사진의 분위기로 원형 모티프 패턴",
            "reference_images": [
                {"upload_id": str(second_photo.id), "purpose": "composition"},
                {"upload_id": str(photo.id), "purpose": "motif"},
            ],
            "user_motif_ids": [str(user_motif.id)],
            "palette": {"mode": "fixed", "colors": ["#abc", "#AABBCC", "#123456"]},
            "pattern_constraints": {
                "motif_scale": "small",
                "density": "dense",
                "arrangement": "staggered",
                "direction": "diagonal",
            },
        },
        headers=headers,
    )
    assert generated.status_code == 200, generated.text
    payload = worker.generate_payloads[-1]
    assert payload["motif_ids"] == [motif.id]
    assert payload["reference_images"] == [
        {
            "image_id": str(second_photo.id),
            "url": "https://storage.googleapis.example/dry-run/"
            "uploads/design_reference/second.webp",
            "content_type": "image/webp",
            "size_bytes": 456,
            "purpose": "composition",
        },
        {
            "image_id": str(photo.id),
            "url": "https://storage.googleapis.example/dry-run/"
            "uploads/design_reference/reference.png",
            "content_type": "image/png",
            "size_bytes": 123,
            "purpose": "motif",
        },
    ]
    assert payload["palette"] == {"mode": "fixed", "colors": ["#AABBCC", "#123456"]}
    assert payload["pattern_constraints"] == {
        "motif_scale": "small",
        "density": "dense",
        "arrangement": "staggered",
        "direction": "diagonal",
    }

    active_signings = 0
    max_active_signings = 0

    async def tracked_signed_read_url(object_key: str) -> str:
        nonlocal active_signings, max_active_signings
        active_signings += 1
        max_active_signings = max(max_active_signings, active_signings)
        try:
            await asyncio.sleep(0)
            return f"https://storage.googleapis.example/{object_key}"
        finally:
            active_signings -= 1

    monkeypatch.setattr(app.state.gcs, "signed_read_url", tracked_signed_read_url)

    turns = (
        await client.get(f"/design/sessions/{design_session['id']}/turns", headers=headers)
    ).json()
    assert max_active_signings == 2
    request_turn = turns[-2]
    assert request_turn["attachments"][0]["filename"] == "구도.webp"
    assert request_turn["attachments"][0]["purpose"] == "composition"
    assert request_turn["attachments"][0]["preview_url"].startswith(
        "https://storage.googleapis.example/"
    )
    assert request_turn["attachments"][1]["filename"] == "참고.png"
    assert request_turn["attachments"][1]["purpose"] == "motif"
    assert request_turn["attachments"][2]["filename"] == "내 원형"
    assert "motif-upload-a1b2c3d4e5f6" in request_turn["attachments"][2]["preview_svg"]
    assert request_turn["payload"]["palette"] == {
        "mode": "fixed",
        "colors": ["#AABBCC", "#123456"],
    }
    assert request_turn["payload"]["pattern_constraints"]["arrangement"] == "staggered"

    await db_session.refresh(photo)
    assert photo.entity_type == "design_reference"
    assert photo.entity_id == design_session["id"]
    assert photo.expires_at is None

    reused_photo = await client.post(
        "/design/generate",
        json={
            "session_id": design_session["id"],
            "prompt": "같은 사진 재사용",
            "reference_images": [{"upload_id": str(photo.id), "purpose": "auto"}],
        },
        headers=headers,
    )
    assert reused_photo.status_code == 409
    assert len(worker.generate_payloads) == 1

    deleted_motif = await client.delete(f"/design/motifs/{user_motif.id}", headers=headers)
    assert deleted_motif.status_code == 204
    turns_after_delete = (
        await client.get(f"/design/sessions/{design_session['id']}/turns", headers=headers)
    ).json()
    assert turns_after_delete[-2]["attachments"][2]["preview_svg"]

    deleted_session = await client.delete(
        f"/design/sessions/{design_session['id']}", headers=headers
    )
    assert deleted_session.status_code == 204
    await db_session.refresh(photo)
    assert photo.entity_type == "design_reference_deleted"
    assert photo.expires_at is not None


async def test_generate_rejects_more_than_two_exact_and_motif_photo_slots_before_charge(
    client, app, db_session, settings
):
    worker = FakeWorker()
    app.state.worker = worker
    user = await make_user(db_session)
    await _fund(db_session, user)
    headers = auth_headers(user, settings)
    design_session = (await client.post("/design/sessions", headers=headers)).json()

    response = await client.post(
        "/design/generate",
        json={
            "session_id": design_session["id"],
            "prompt": "모티프 충돌",
            "reference_images": [{"upload_id": str(uuid.uuid4()), "purpose": "motif"}],
            "user_motif_ids": [str(uuid.uuid4()), str(uuid.uuid4())],
        },
        headers=headers,
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": "직접 선택한 모티프와 모티프 형태 참고 사진은 합쳐서 2개까지 사용할 수 있습니다",
        "code": "motif_input_conflict",
        "stage": "constraints",
    }
    assert worker.generate_payloads == []
    assert await ledger.get_balance(db_session, user.id) == {
        "total": 30,
        "paid": 0,
        "bonus": 30,
    }


async def test_private_intent_motif_rejects_cross_user_access_at_all_api_boundaries(
    client, app, db_session, settings
):
    worker = FakeWorker()
    app.state.worker = worker
    owner = await make_user(db_session)
    attacker = await make_user(db_session)
    await _fund(db_session, attacker)
    motif = Motif(
        id="upload-111111111111",
        symbol=(
            '<symbol id="motif-upload-111111111111" viewBox="-0.5 -0.5 1 1">'
            '<circle cx="0" cy="0" r="0.4" fill="currentColor"/></symbol>'
        ),
        bbox=[-0.5, -0.5, 0.5, 0.5],
        anchor=[0, 0],
        source="user_upload",
    )
    attacker_session = DesignSession(user_id=attacker.id)
    db_session.add_all([motif, attacker_session])
    await db_session.flush()
    db_session.add(UserMotif(user_id=owner.id, motif_id=motif.id, name="소유자 모티프"))
    await db_session.commit()
    intent = _motif_intent(motif.id)
    headers = auth_headers(attacker, settings)

    generated = await client.post(
        "/design/generate",
        json={"session_id": str(attacker_session.id), "intent": intent},
        headers=headers,
    )
    selected = await client.patch(
        f"/design/sessions/{attacker_session.id}",
        json={"current_intent": intent},
        headers=headers,
    )
    finalized_body = await client.post(
        f"/design/sessions/{attacker_session.id}/finalize",
        json={"intent": intent},
        headers=headers,
    )

    attacker_session.current_intent = intent
    await db_session.commit()
    finalized_stored = await client.post(
        f"/design/sessions/{attacker_session.id}/finalize",
        json={},
        headers=headers,
    )

    for response in (generated, selected, finalized_body, finalized_stored):
        assert response.status_code == 409
        assert response.json()["code"] == "invalid_user_motif"
    assert worker.generate_payloads == []
    assert await db_session.scalar(select(func.count()).select_from(GenerationJob)) == 0
    assert await ledger.get_balance(db_session, attacker.id) == {
        "total": 30,
        "paid": 0,
        "bonus": 30,
    }


async def test_deleted_library_motif_remains_authorized_for_its_historical_session(
    client, app, db_session, settings
):
    worker = FakeWorker()
    app.state.worker = worker
    user = await make_user(db_session)
    await _fund(db_session, user)
    await _seed_finalize_limit(db_session)
    motif = Motif(
        id="upload-222222222222",
        symbol=(
            '<symbol id="motif-upload-222222222222" viewBox="-0.5 -0.5 1 1">'
            '<circle cx="0" cy="0" r="0.4" fill="currentColor"/></symbol>'
        ),
        bbox=[-0.5, -0.5, 0.5, 0.5],
        anchor=[0, 0],
        source="user_upload",
    )
    design_session = DesignSession(user_id=user.id)
    db_session.add_all([motif, design_session])
    await db_session.flush()
    link = UserMotif(user_id=user.id, motif_id=motif.id, name="과거 모티프")
    turn = DesignSessionTurn(
        session_id=design_session.id,
        seq=1,
        role="user",
        payload={"type": "generate_request", "mode": "prompt"},
    )
    db_session.add_all([link, turn])
    await db_session.flush()
    db_session.add(
        DesignTurnAttachment(
            turn_id=turn.id,
            kind="svg",
            image_id=None,
            motif_id=motif.id,
            purpose=None,
            filename=link.name,
            ordinal=0,
        )
    )
    await db_session.commit()
    headers = auth_headers(user, settings)
    deleted = await client.delete(f"/design/motifs/{link.id}", headers=headers)
    assert deleted.status_code == 204
    assert (
        await db_session.scalar(
            select(func.count()).select_from(UserMotif).where(UserMotif.id == link.id)
        )
        == 0
    )

    intent = _motif_intent(motif.id)
    selected = await client.patch(
        f"/design/sessions/{design_session.id}",
        json={"current_intent": intent},
        headers=headers,
    )
    generated = await client.post(
        "/design/generate",
        json={"session_id": str(design_session.id), "intent": intent},
        headers=headers,
    )
    finalized = await client.post(
        f"/design/sessions/{design_session.id}/finalize",
        json={},
        headers=headers,
    )

    assert selected.status_code == 200, selected.text
    assert generated.status_code == 200, generated.text
    assert worker.generate_payloads[-1]["intent"] == intent
    assert finalized.status_code == 201, finalized.text
    assert finalized.json()["params"]["intent"] == intent


async def test_photo_turn_attachment_requires_reference_purpose_in_postgres(
    client, db_session, settings
):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    design_session = (await client.post("/design/sessions", headers=headers)).json()
    turn = (
        await client.post(
            f"/design/sessions/{design_session['id']}/turns",
            json={"role": "user", "payload": {"type": "draft"}},
            headers=headers,
        )
    ).json()
    photo = Image(
        object_key="uploads/design_reference/null-purpose.png",
        entity_type="design_reference_upload",
        entity_id="uploads/design_reference/null-purpose.png",
        uploaded_by=user.id,
        content_type="image/png",
        size_bytes=10,
        original_filename="null-purpose.png",
        upload_completed_at=datetime.now(UTC),
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    db_session.add(photo)
    await db_session.flush()
    db_session.add(
        DesignTurnAttachment(
            turn_id=uuid.UUID(turn["id"]),
            kind="photo",
            image_id=photo.id,
            motif_id=None,
            purpose=None,
            filename="null-purpose.png",
            ordinal=0,
        )
    )

    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


async def test_svg_only_generate_is_allowed_but_photo_only_requires_prompt(
    client, app, db_session, settings
):
    worker = FakeWorker()
    app.state.worker = worker
    user = await make_user(db_session)
    await _fund(db_session, user)
    headers = auth_headers(user, settings)
    motif = Motif(
        id="upload-a1b2c3d4e5f6",
        symbol=(
            '<symbol id="motif-upload-a1b2c3d4e5f6" viewBox="-0.5 -0.5 1 1">'
            '<circle cx="0" cy="0" r="0.4" fill="currentColor"/></symbol>'
        ),
        bbox=[-0.5, -0.5, 0.5, 0.5],
        anchor=[0, 0],
        source="user_upload",
    )
    db_session.add(motif)
    await db_session.flush()
    user_motif = UserMotif(user_id=user.id, motif_id=motif.id, name="원형")
    db_session.add(user_motif)
    await db_session.commit()

    svg_only = await client.post(
        "/design/generate",
        json={"prompt": "  ", "user_motif_ids": [str(user_motif.id)]},
        headers=headers,
    )
    assert svg_only.status_code == 200, svg_only.text
    assert worker.generate_payloads[-1]["motif_ids"] == [motif.id]
    assert "prompt" not in worker.generate_payloads[-1]

    photo_only = await client.post(
        "/design/generate",
        json={"reference_images": [{"upload_id": str(uuid.uuid4()), "purpose": "auto"}]},
        headers=headers,
    )
    assert photo_only.status_code == 422


async def test_user_motif_library_is_idempotent_and_owner_scoped(client, app, db_session, settings):
    worker = FakeWorker()
    app.state.worker = worker
    owner = await make_user(db_session)
    other = await make_user(db_session)
    owner_headers = auth_headers(owner, settings)

    imported = await client.post(
        "/design/motifs",
        json={"name": "원형", "svg": "<svg/>"},
        headers=owner_headers,
    )
    repeated = await client.post(
        "/design/motifs",
        json={"name": "다른 이름", "svg": "<svg/>"},
        headers=owner_headers,
    )
    assert imported.status_code == repeated.status_code == 201
    assert imported.json()["id"] == repeated.json()["id"]
    assert imported.json()["name"] == "원형"
    stored = await db_session.get(Motif, "upload-a1b2c3d4e5f6")
    assert stored is not None and stored.source == "user_upload"
    assert len((await client.get("/design/motifs", headers=owner_headers)).json()) == 1
    assert (await client.get("/design/motifs", headers=auth_headers(other, settings))).json() == []
    denied = await client.delete(
        f"/design/motifs/{imported.json()['id']}",
        headers=auth_headers(other, settings),
    )
    assert denied.status_code == 403


async def test_user_motif_quota_failure_does_not_persist_ownerless_motif(
    client, app, db_session, settings
):
    worker = FakeWorker()
    app.state.worker = worker
    user = await make_user(db_session)
    motif_ids: list[str] = []
    for index in range(100):
        motif_id = f"upload-{index:012x}"
        motif_ids.append(motif_id)
        db_session.add(
            Motif(
                id=motif_id,
                symbol=(
                    f'<symbol id="motif-{motif_id}" viewBox="-0.5 -0.5 1 1">'
                    '<circle cx="0" cy="0" r="0.4" fill="currentColor"/></symbol>'
                ),
                bbox=[-0.5, -0.5, 0.5, 0.5],
                anchor=[0, 0],
                source="user_upload",
            )
        )
    await db_session.flush()
    db_session.add_all(
        [
            UserMotif(user_id=user.id, motif_id=motif_id, name=f"모티프 {index + 1}")
            for index, motif_id in enumerate(motif_ids)
        ]
    )
    await db_session.commit()

    response = await client.post(
        "/design/motifs",
        json={"name": "101번째", "svg": "<svg/>"},
        headers=auth_headers(user, settings),
    )

    assert response.status_code == 409
    assert response.json()["code"] == "user_motif_limit"
    assert await db_session.get(Motif, "upload-a1b2c3d4e5f6") is None


async def test_design_helper_endpoints_preserve_context_ownership_and_do_not_charge(
    client, app, db_session, settings
):
    worker = FakeWorker()
    app.state.worker = worker
    owner = await make_user(db_session)
    other = await make_user(db_session)
    now = datetime.now(UTC)
    photo = Image(
        object_key="uploads/design_reference/helper.png",
        entity_type="design_reference_upload",
        entity_id="uploads/design_reference/helper.png",
        uploaded_by=owner.id,
        content_type="image/png",
        size_bytes=321,
        original_filename="helper.png",
        upload_completed_at=now,
        expires_at=now + timedelta(hours=1),
    )
    motif = Motif(
        id="upload-a1b2c3d4e5f6",
        symbol=(
            '<symbol id="motif-upload-a1b2c3d4e5f6" viewBox="-0.5 -0.5 1 1">'
            '<circle cx="0" cy="0" r="0.4" fill="currentColor"/></symbol>'
        ),
        bbox=[-0.5, -0.5, 0.5, 0.5],
        anchor=[0, 0],
        source="user_upload",
    )
    db_session.add_all([photo, motif])
    await db_session.flush()
    user_motif = UserMotif(user_id=owner.id, motif_id=motif.id, name="원형 문양")
    db_session.add(user_motif)
    await db_session.commit()
    owner_headers = auth_headers(owner, settings)

    palette = await client.post(
        "/design/palette/extract",
        json={"upload_id": str(photo.id), "color_count": 3},
        headers=owner_headers,
    )
    text_preview = await client.post(
        "/design/motifs/text-preview",
        json={
            "text": " 이니셜 A1 ",
            "font_id": "nanum-myeongjo",
            "font_weight": 700,
            "letter_spacing": 0.1,
        },
        headers=owner_headers,
    )
    photo_preview = await client.post(
        "/design/motifs/photo-preview",
        json={
            "upload_id": str(photo.id),
            "remove_background": True,
            "simplification": "high",
            "color_count": 3,
        },
        headers=owner_headers,
    )
    ideas = await client.post(
        "/design/ideas",
        json={
            "prompt": "차분한 넥타이",
            "reference_images": [{"upload_id": str(photo.id), "purpose": "color_mood"}],
            "user_motif_ids": [str(user_motif.id)],
            "palette": {"mode": "fixed", "colors": ["#123", "#456789"]},
            "pattern_constraints": {"density": "sparse", "arrangement": "scatter"},
            "count": 3,
        },
        headers=owner_headers,
    )

    assert palette.status_code == 200
    assert palette.json() == {"colors": ["#123456", "#ABCDEF", "#FEDCBA"]}
    assert text_preview.status_code == 200
    assert photo_preview.status_code == 200
    assert photo_preview.json()["background_confidence"] == 0.9
    assert photo_preview.json()["processed_preview_base64"]
    assert ideas.status_code == 200
    assert len(ideas.json()["ideas"]) == 3
    assert worker.palette_extract_payloads[-1]["image"]["image_id"] == str(photo.id)
    assert worker.palette_extract_payloads[-1]["image"]["purpose"] == "color_mood"
    assert worker.text_preview_payloads[-1]["text"] == "이니셜 A1"
    assert worker.photo_preview_payloads[-1]["image"]["purpose"] == "motif"
    idea_payload = worker.idea_payloads[-1]
    assert idea_payload["reference_images"][0]["purpose"] == "color_mood"
    assert idea_payload["motif_ids"] == [motif.id]
    assert idea_payload["motifs"] == [{"motif_id": motif.id, "name": "원형 문양"}]
    assert idea_payload["palette"] == {"mode": "fixed", "colors": ["#112233", "#456789"]}
    assert idea_payload["pattern_constraints"] == {
        "motif_scale": "auto",
        "density": "sparse",
        "arrangement": "scatter",
        "direction": "auto",
    }
    assert await db_session.scalar(select(func.count()).select_from(DesignSessionTurn)) == 0
    assert await ledger.get_balance(db_session, owner.id) == {"total": 0, "paid": 0, "bonus": 0}

    for path, body in (
        ("/design/palette/extract", {"upload_id": str(photo.id)}),
        (
            "/design/motifs/photo-preview",
            {"upload_id": str(photo.id), "color_count": 3},
        ),
        (
            "/design/ideas",
            {"reference_images": [{"upload_id": str(photo.id), "purpose": "composition"}]},
        ),
    ):
        response = await client.post(path, json=body, headers=auth_headers(other, settings))
        assert response.status_code == 409
        assert response.json()["code"] == "invalid_design_reference"

    other_motif_ideas = await client.post(
        "/design/ideas",
        json={"user_motif_ids": [str(user_motif.id)]},
        headers=auth_headers(other, settings),
    )
    assert other_motif_ideas.status_code == 409
    assert other_motif_ideas.json()["code"] == "invalid_user_motif"


async def test_design_ideas_require_auth_and_have_separate_rate_limit(
    client, app, db_session, settings
):
    worker = FakeWorker()
    app.state.worker = worker
    anonymous = await client.post("/design/ideas", json={"prompt": "꽃무늬"})
    assert anonymous.status_code == 401

    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    app.state.design_ideas_rate_limiter = AuthRateLimiter(
        attempts=1,
        window_seconds=60,
        max_keys=100,
        detail="아이디어 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
    )
    first = await client.post("/design/ideas", json={"prompt": "꽃무늬"}, headers=headers)
    limited = await client.post("/design/ideas", json={"prompt": "기하학"}, headers=headers)
    assert first.status_code == 200
    assert limited.status_code == 429
    assert limited.json()["code"] == "rate_limited"
    assert len(worker.idea_payloads) == 1
    assert await ledger.get_balance(db_session, user.id) == {"total": 0, "paid": 0, "bonus": 0}


@pytest.mark.parametrize(
    "body",
    [
        {"prompt": "x", "palette": {"mode": "fixed", "colors": ["#123456"]}},
        {"prompt": "x", "palette": {"mode": "fixed", "colors": ["not-a-color", "#fff"]}},
        {"prompt": "x", "pattern_constraints": {"arrangement": "unsupported"}},
        {"prompt": "x", "reference_image_upload_ids": []},
        {
            "prompt": "x",
            "palette": {
                "mode": "fixed",
                "colors": ["#fff", "#000"],
                "colour": "#123456",
            },
        },
        {
            "prompt": "x",
            "reference_images": [{"upload_id": str(uuid.uuid4()), "purpose": "texture"}],
        },
        {
            "intent": {"canvas": {"tile_mm": 24}},
            "reference_images": [{"upload_id": str(uuid.uuid4()), "purpose": "auto"}],
        },
        {
            "intent": {"canvas": {"tile_mm": 24}},
            "user_motif_ids": [str(uuid.uuid4())],
        },
    ],
)
async def test_design_constraints_reject_invalid_values_before_worker(
    body, client, app, db_session, settings
):
    worker = FakeWorker()
    app.state.worker = worker
    user = await make_user(db_session)
    response = await client.post(
        "/design/generate",
        json=body,
        headers=auth_headers(user, settings),
    )
    assert response.status_code == 422
    assert worker.generate_payloads == []


async def test_text_motif_restricts_characters_and_normalizes_nfc(
    client, app, db_session, settings
):
    worker = FakeWorker()
    app.state.worker = worker
    user = await make_user(db_session)
    headers = auth_headers(user, settings)

    valid = await client.post(
        "/design/motifs/text-preview",
        json={"text": "가 A1", "font_id": "nanum-gothic", "font_weight": 400},
        headers=headers,
    )
    invalid = await client.post(
        "/design/motifs/text-preview",
        json={"text": "Привет"},
        headers=headers,
    )
    assert valid.status_code == 200
    assert worker.text_preview_payloads[-1]["text"] == "가 A1"
    assert invalid.status_code == 422


async def test_finalize_dispatch_failure_marks_job_failed_and_frees_quota_slot(
    client, app, db_session, settings
):
    user = await make_user(db_session)
    # 한도 1 — 실패 job이 카운트에서 빠져야만 재시도가 성공한다
    await _seed_finalize_limit(db_session, limit=1)
    headers = auth_headers(user, settings)
    design_session = (await client.post("/design/sessions", headers=headers)).json()
    app.state.tasks = FailingTaskQueue()

    failed = await client.post(
        f"/design/sessions/{design_session['id']}/finalize",
        json={"intent": {"canvas": {"tile_mm": 24}, "layers": []}},
        headers=headers,
    )
    assert failed.status_code == 502
    assert failed.json()["code"] == "upstream_error"

    persisted_session = await db_session.get(DesignSession, uuid.UUID(design_session["id"]))
    assert persisted_session is not None
    job = await db_session.scalar(
        select(GenerationJob).where(GenerationJob.session_id == persisted_session.id)
    )
    assert job is not None and job.status == "failed"
    assert job.error_message == "finalize 작업 전달에 실패했습니다"

    # failed job은 24시간 쿼터 카운트에서 빠지므로 한도 1에서도 재시도가 성공한다.
    app.state.tasks = DryRunTaskQueue()
    retry = await client.post(
        f"/design/sessions/{design_session['id']}/finalize",
        json={"intent": {"canvas": {"tile_mm": 24}, "layers": []}},
        headers=headers,
    )
    assert retry.status_code == 201


async def test_finalize_ambiguous_enqueue_returns_claimed_job(client, app, db_session, settings):
    user = await make_user(db_session)
    await _seed_finalize_limit(db_session)
    headers = auth_headers(user, settings)
    design_session = (await client.post("/design/sessions", headers=headers)).json()
    app.state.tasks = ClaimedThenAmbiguousTaskQueue(app.state.sessionmaker)

    response = await client.post(
        f"/design/sessions/{design_session['id']}/finalize",
        json={"intent": {"canvas": {"tile_mm": 24}, "layers": []}},
        headers=headers,
    )

    assert response.status_code == 201
    assert response.json()["status"] == "processing"
    job = await db_session.get(GenerationJob, uuid.UUID(response.json()["id"]))
    assert job is not None
    assert job.status == "processing"
    assert job.attempts == 1
    assert job.error_message is None


async def _make_finalize_job(db_session, user, *, status="queued", **extra):
    design_session = DesignSession(user_id=user.id, status="active")
    db_session.add(design_session)
    await db_session.flush()
    job = GenerationJob(
        user_id=user.id,
        session_id=design_session.id,
        kind="finalize",
        status=status,
        params={"intent": {}},
        **extra,
    )
    db_session.add(job)
    await db_session.commit()
    return design_session, job


async def test_cancel_finalize_job(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    _, job = await _make_finalize_job(db_session, user, status="queued")

    response = await client.post(f"/design/jobs/{job.id}/cancel", headers=headers)

    assert response.status_code == 200
    assert response.json()["status"] == "canceled"
    assert response.json()["error_message"] == FINALIZE_CANCELED_MESSAGE


async def test_cancel_finalize_job_is_idempotent(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    _, job = await _make_finalize_job(db_session, user, status="processing")

    first = await client.post(f"/design/jobs/{job.id}/cancel", headers=headers)
    second = await client.post(f"/design/jobs/{job.id}/cancel", headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["status"] == "canceled"


async def test_cancel_rejects_terminal_jobs_and_other_kinds(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    _, succeeded = await _make_finalize_job(
        db_session, user, status="succeeded", result={"object_key": "fabric/abc.png"}
    )
    _, failed = await _make_finalize_job(db_session, user, status="failed")
    export_session = DesignSession(user_id=user.id, status="active")
    db_session.add(export_session)
    await db_session.flush()
    export_job = GenerationJob(
        user_id=user.id,
        session_id=export_session.id,
        kind="export",
        status="queued",
        params={},
    )
    db_session.add(export_job)
    await db_session.commit()

    assert (
        await client.post(f"/design/jobs/{succeeded.id}/cancel", headers=headers)
    ).status_code == 409
    assert (
        await client.post(f"/design/jobs/{failed.id}/cancel", headers=headers)
    ).status_code == 409
    assert (
        await client.post(f"/design/jobs/{export_job.id}/cancel", headers=headers)
    ).status_code == 409
    # 종결 상태 취소 시도는 결과를 건드리지 않는다
    await db_session.refresh(succeeded)
    assert succeeded.status == "succeeded"
    assert succeeded.result == {"object_key": "fabric/abc.png"}
    await db_session.refresh(failed)
    assert failed.status == "failed"


async def test_delete_session_removes_turns_but_keeps_finalize_results(
    client, db_session, settings
):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    design_session, job = await _make_finalize_job(
        db_session, user, status="succeeded", result={"object_key": "fabric/keep.png"}
    )
    session_id, job_id = design_session.id, job.id
    db_session.add(
        DesignSessionTurn(
            session_id=session_id,
            seq=1,
            role="user",
            payload={"type": "generate_request", "prompt": "체크 패턴"},
        )
    )
    await db_session.commit()

    response = await client.delete(f"/design/sessions/{session_id}", headers=headers)

    assert response.status_code == 204
    db_session.expire_all()
    assert await db_session.get(DesignSession, session_id) is None
    remaining_turns = await db_session.scalar(
        select(func.count())
        .select_from(DesignSessionTurn)
        .where(DesignSessionTurn.session_id == session_id)
    )
    assert remaining_turns == 0
    # finalize 결과물은 SET NULL로 살아남아 완성본 목록에 계속 노출된다
    surviving = await db_session.get(GenerationJob, job_id)
    assert surviving is not None
    assert surviving.session_id is None
    assert surviving.result == {"object_key": "fabric/keep.png"}
    listed = await client.get("/design/jobs", headers=headers)
    assert [row["id"] for row in listed.json()] == [str(job_id)]


async def test_delete_job_removes_row_and_result_object(client, app, db_session, settings):
    settings.gcp_project_id = "test-project"
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    _, job = await _make_finalize_job(
        db_session, user, status="succeeded", result={"object_key": "fabric/delete-me.png"}
    )
    job_id = job.id

    response = await client.delete(f"/design/jobs/{job_id}", headers=headers)

    assert response.status_code == 204
    db_session.expire_all()
    # 삭제된 행은 24시간 쿼터 카운트에서 빠진다 — 의도된 정책 (router docstring)
    assert await db_session.get(GenerationJob, job_id) is None
    assert app.state.gcs.deleted_from == [("test-project-assets", "fabric/delete-me.png")]


async def test_delete_job_rejects_active_and_skips_object_cleanup_without_result(
    client, app, db_session, settings
):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    for status in ("queued", "processing"):
        _, active = await _make_finalize_job(db_session, user, status=status)
        active_id = active.id
        response = await client.delete(f"/design/jobs/{active_id}", headers=headers)
        assert response.status_code == 409
        remaining = await db_session.scalar(
            select(func.count()).select_from(GenerationJob).where(GenerationJob.id == active_id)
        )
        assert remaining == 1

    _, failed = await _make_finalize_job(db_session, user, status="failed")
    failed_id = failed.id
    assert (await client.delete(f"/design/jobs/{failed_id}", headers=headers)).status_code == 204
    assert app.state.gcs.deleted == []


async def test_get_job_lazily_cancels_past_ttl(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    old = datetime.now(UTC) - timedelta(hours=2)
    _, job = await _make_finalize_job(
        db_session, user, status="queued", created_at=old, updated_at=old
    )

    response = await client.get(f"/design/jobs/{job.id}", headers=headers)

    assert response.status_code == 200
    assert response.json()["status"] == "canceled"
    assert response.json()["error_message"] == FINALIZE_STALE_MESSAGE

    # 반복 조회는 멱등
    again = await client.get(f"/design/jobs/{job.id}", headers=headers)
    assert again.json()["status"] == "canceled"


async def test_get_job_keeps_active_lease_processing_past_ttl(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    old = datetime.now(UTC) - timedelta(hours=2)
    _, job = await _make_finalize_job(
        db_session,
        user,
        status="processing",
        attempts=1,
        created_at=old,
        updated_at=datetime.now(UTC),
    )

    response = await client.get(f"/design/jobs/{job.id}", headers=headers)

    assert response.status_code == 200
    assert response.json()["status"] == "processing"


async def test_prompt_generate_select_and_finalize(client, app, db_session, settings):
    app.state.worker = FakeWorker()
    user = await make_user(db_session)
    await _fund(db_session, user)
    await _seed_finalize_limit(db_session)
    headers = auth_headers(user, settings)
    design_session = (await client.post("/design/sessions", headers=headers)).json()

    generated = await client.post(
        "/design/generate",
        json={
            "session_id": design_session["id"],
            "prompt": "잔잔한 네이비 페이즐리",
            "candidate_count": 4,
        },
        headers=headers,
    )
    assert generated.status_code == 200
    body = generated.json()
    assert len(body["intents"]) == 1

    turns = (
        await client.get(f"/design/sessions/{design_session['id']}/turns", headers=headers)
    ).json()
    assert [turn["role"] for turn in turns] == ["user", "assistant"]
    assert turns[0]["payload"] == {
        "type": "generate_request",
        "mode": "prompt",
        "prompt": "잔잔한 네이비 페이즐리",
        "seed": None,
        "colorway": None,
        "candidate_count": 4,
        "palette": {"mode": "auto", "colors": []},
        "pattern_constraints": {
            "motif_scale": "auto",
            "density": "auto",
            "arrangement": "auto",
            "direction": "auto",
        },
    }

    candidate = body["candidates"][0]
    selected = await client.patch(
        f"/design/sessions/{design_session['id']}",
        json={
            "current_intent": body["intents"][candidate["design_index"]],
            "seed": candidate["seed"],
            "colorway": candidate["colorway_id"],
        },
        headers=headers,
    )
    assert selected.status_code == 200
    assert selected.json()["current_intent"] == body["intents"][0]

    finalized = await client.post(
        f"/design/sessions/{design_session['id']}/finalize", json={}, headers=headers
    )
    assert finalized.status_code == 201
    assert finalized.json()["params"]["intent"] == body["intents"][0]


async def test_generate_rejects_mixing_intent_and_prompt(client, app, db_session, settings):
    worker = FakeWorker()
    app.state.worker = worker
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    base_intent = {"canvas": {"tile_mm": 24}, "layers": [], "palette": {"slots": []}}

    response = await client.post(
        "/design/generate",
        json={
            "intent": base_intent,
            "prompt": "배경은 유지하고 모티프를 더 작게 바꿔줘",
        },
        headers=headers,
    )

    assert response.status_code == 422
    assert worker.generate_payloads == []


def test_public_asset_url_uses_project_bucket_and_quotes_key():
    settings = Settings(env="test", gcs_assets_bucket="configured-assets", gcs_emulator_host="")
    assert public_asset_url(settings, "fabric/a b#.png") == (
        "https://storage.googleapis.com/configured-assets/fabric/a%20b%23.png"
    )
    assert public_asset_url(settings, "") is None


async def test_list_generation_jobs_filters_owner_kind_status_session_and_paginates(
    client, db_session, settings
):
    settings.gcp_project_id = "test-project"
    settings.gcs_assets_bucket = "configured-assets"
    settings.gcs_assets_public_base_url = "https://cdn.example.test/assets/"
    owner = await make_user(db_session)
    other = await make_user(db_session)
    owner_session_a = DesignSession(user_id=owner.id)
    owner_session_b = DesignSession(user_id=owner.id)
    other_session = DesignSession(user_id=other.id)
    db_session.add_all([owner_session_a, owner_session_b, other_session])
    await db_session.flush()

    now = datetime.now(UTC)
    older = GenerationJob(
        user_id=owner.id,
        session_id=owner_session_a.id,
        kind="finalize",
        status="succeeded",
        params={},
        result={"object_key": "fabric/older.png"},
        created_at=now - timedelta(minutes=3),
    )
    newer = GenerationJob(
        user_id=owner.id,
        session_id=owner_session_a.id,
        kind="finalize",
        status="succeeded",
        params={},
        result={"object_key": "fabric/newer file.png"},
        created_at=now - timedelta(minutes=2),
    )
    newest_other_session = GenerationJob(
        user_id=owner.id,
        session_id=owner_session_b.id,
        kind="finalize",
        status="succeeded",
        params={},
        result={"object_key": "fabric/newest.png"},
        created_at=now - timedelta(minutes=1),
    )
    failed = GenerationJob(
        user_id=owner.id,
        session_id=owner_session_a.id,
        kind="finalize",
        status="failed",
        params={},
        result=None,
        created_at=now,
    )
    exported = GenerationJob(
        user_id=owner.id,
        session_id=owner_session_a.id,
        kind="export",
        status="succeeded",
        params={},
        result={"object_key": "exports/design.png"},
        created_at=now,
    )
    other_job = GenerationJob(
        user_id=other.id,
        session_id=other_session.id,
        kind="finalize",
        status="succeeded",
        params={},
        result={"object_key": "fabric/private.png"},
        created_at=now,
    )
    db_session.add_all([older, newer, newest_other_session, failed, exported, other_job])
    await db_session.commit()

    headers = auth_headers(owner, settings)
    all_jobs = (await client.get("/design/jobs", headers=headers)).json()
    assert [job["id"] for job in all_jobs] == [
        str(failed.id),
        str(newest_other_session.id),
        str(newer.id),
        str(older.id),
    ]
    assert all_jobs[2]["result_url"] == ("https://cdn.example.test/assets/fabric/newer%20file.png")

    succeeded_jobs = (await client.get("/design/jobs?status=succeeded", headers=headers)).json()
    assert [job["id"] for job in succeeded_jobs] == [
        str(newest_other_session.id),
        str(newer.id),
        str(older.id),
    ]

    page = (
        await client.get("/design/jobs?status=succeeded&limit=1&offset=1", headers=headers)
    ).json()
    assert [job["id"] for job in page] == [str(newer.id)]

    by_session = (
        await client.get(f"/design/jobs?session_id={owner_session_b.id}", headers=headers)
    ).json()
    assert [job["id"] for job in by_session] == [str(newest_other_session.id)]

    failed_jobs = (await client.get("/design/jobs?status=failed", headers=headers)).json()
    assert [job["id"] for job in failed_jobs] == [str(failed.id)]
    assert failed_jobs[0]["result_url"] is None

    exports = (await client.get("/design/jobs?kind=export", headers=headers)).json()
    assert [job["id"] for job in exports] == [str(exported.id)]

    detail = await client.get(f"/design/jobs/{newer.id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["result_url"].endswith("/fabric/newer%20file.png")

    forbidden = await client.get(f"/design/jobs/{other_job.id}", headers=headers)
    assert forbidden.status_code == 403


async def test_create_design_order_reference_copies_owned_succeeded_finalize(
    client, app, db_session, settings
):
    settings.gcp_project_id = "test-project"
    owner = await make_user(db_session)
    other = await make_user(db_session)
    design_session = DesignSession(user_id=owner.id)
    db_session.add(design_session)
    await db_session.flush()
    job = GenerationJob(
        user_id=owner.id,
        session_id=design_session.id,
        kind="finalize",
        status="succeeded",
        params={},
        result={"object_key": "fabric/result.png"},
    )
    invalid_job = GenerationJob(
        user_id=owner.id,
        session_id=design_session.id,
        kind="finalize",
        status="failed",
        params={},
        result=None,
    )
    db_session.add_all([job, invalid_job])
    await db_session.commit()

    headers = auth_headers(owner, settings)
    response = await client.post(f"/design/jobs/{job.id}/order-reference", headers=headers)
    assert response.status_code == 200
    destination = response.json()["object_key"]
    prefix = f"uploads/custom_order/design-{job.id}-"
    assert destination.startswith(prefix)
    assert destination.endswith(".png")
    assert len(destination.removeprefix(prefix).removesuffix(".png")) == 32
    assert response.json()["object_key"] == destination
    assert response.json()["upload_id"] is not None
    staged_order_image = await db_session.get(Image, uuid.UUID(response.json()["upload_id"]))
    assert staged_order_image is not None
    assert staged_order_image.entity_type == "custom_order_upload"
    assert staged_order_image.upload_completed_at is not None
    assert app.state.gcs.copied == [("test-project-assets", "fabric/result.png", destination)]

    repeated = await client.post(f"/design/jobs/{job.id}/order-reference", headers=headers)
    assert repeated.status_code == 200
    repeated_destination = repeated.json()["object_key"]
    assert repeated_destination.startswith(prefix)
    assert repeated_destination.endswith(".png")
    assert repeated_destination != destination
    assert app.state.gcs.copied[-1] == (
        "test-project-assets",
        "fabric/result.png",
        repeated_destination,
    )

    quote_reference = await client.post(
        f"/design/jobs/{job.id}/order-reference?kind=quote_request", headers=headers
    )
    assert quote_reference.status_code == 200
    quote_destination = quote_reference.json()["object_key"]
    assert quote_destination.startswith(f"uploads/quote_request/design-{job.id}-")
    staged = await db_session.scalar(select(Image).where(Image.object_key == quote_destination))
    assert staged is not None
    assert staged.entity_type == "quote_request_upload"
    assert staged.entity_id == quote_destination
    assert staged.uploaded_by == owner.id
    assert staged.upload_completed_at is not None

    invalid = await client.post(f"/design/jobs/{invalid_job.id}/order-reference", headers=headers)
    assert invalid.status_code == 409

    forbidden = await client.post(
        f"/design/jobs/{job.id}/order-reference",
        headers=auth_headers(other, settings),
    )
    assert forbidden.status_code == 403


async def test_design_order_reference_deletes_copy_when_validation_fails(
    client, app, db_session, settings
):
    class InvalidMetadataGcs(DryRunGcsClient):
        upload_required = True

        async def object_metadata(self, object_key, *, bucket_name=None):
            return GcsObjectMetadata(size_bytes=0, content_type="image/png")

    settings.gcp_project_id = "test-project"
    app.state.gcs = InvalidMetadataGcs()
    owner = await make_user(db_session)
    design_session = DesignSession(user_id=owner.id)
    db_session.add(design_session)
    await db_session.flush()
    job = GenerationJob(
        user_id=owner.id,
        session_id=design_session.id,
        kind="finalize",
        status="succeeded",
        params={},
        result={"object_key": "fabric/result.png"},
    )
    db_session.add(job)
    await db_session.commit()

    response = await client.post(
        f"/design/jobs/{job.id}/order-reference",
        headers=auth_headers(owner, settings),
    )

    assert response.status_code == 400
    destination = app.state.gcs.copied[0][2]
    assert app.state.gcs.deleted == [destination]
    assert await db_session.scalar(select(Image).where(Image.object_key == destination)) is None


def test_known_weaves_match_worker_assets():
    """api의 얕은 weave 사전검증 상수는 워커 에셋 stem과 정확히 일치해야 한다 —
    어긋나면 유효한 weave가 400되거나 잘못된 weave가 예산을 태운다."""
    stems = sorted(p.stem for p in _WORKER_FABRIC_ASSETS.glob("*.png"))
    assert sorted(KNOWN_WEAVES) == stems


async def test_finalize_forwards_texture_params(client, app, db_session, settings):
    """yarn_dyed 텍스처 4필드가 job.params로 전달되고, None 필드는 빠진다."""
    app.state.worker = FakeWorker()
    user = await make_user(db_session)
    await _seed_finalize_limit(db_session)
    headers = auth_headers(user, settings)
    design_session = (await client.post("/design/sessions", headers=headers)).json()

    intent = {"canvas": {"tile_mm": 24}, "layers": [], "palette": {"slots": []}, "colorways": []}
    job = await client.post(
        f"/design/sessions/{design_session['id']}/finalize",
        json={
            "intent": intent,
            "production_method": "yarn_dyed",
            "weave": "herringbone",
            "material_map": {"accent": "solid"},
            "texture_strength": 2.0,
            "relief_strength": 0.3,
        },
        headers=headers,
    )
    assert job.status_code == 201
    params = job.json()["params"]
    assert params["weave"] == "herringbone"
    assert params["material_map"] == {"accent": "solid"}
    assert params["texture_strength"] == 2.0
    assert params["relief_strength"] == 0.3

    # None 텍스처 필드는 params에서 제외 — 워커 기본값을 살린다
    plain = await client.post(
        f"/design/sessions/{design_session['id']}/finalize",
        json={"intent": intent, "dpi": 300},
        headers=headers,
    )
    plain_params = plain.json()["params"]
    assert "weave" not in plain_params and "material_map" not in plain_params
    assert "texture_strength" not in plain_params and "relief_strength" not in plain_params


async def test_finalize_rejects_unknown_weave(client, app, db_session, settings):
    app.state.worker = FakeWorker()
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    design_session = (await client.post("/design/sessions", headers=headers)).json()
    res = await client.post(
        f"/design/sessions/{design_session['id']}/finalize",
        json={"intent": {"x": 1}, "weave": "burlap"},
        headers=headers,
    )
    assert res.status_code == 400
    assert res.json()["code"] == "unknown_weave"


# ---- generate 과금 (P1 — use_tokens 선차감 + 실패 환불) ----


class FailingWorker(FakeWorker):
    async def generate(self, payload):
        raise UpstreamError("이미지 워커 호출에 실패했습니다")


class FailOnceWorker(FakeWorker):
    def __init__(self):
        super().__init__()
        self.failed = False

    async def generate(self, payload):
        if not self.failed:
            self.failed = True
            self.generate_payloads.append(payload)
            raise UpstreamError("이미지 워커 호출에 실패했습니다")
        return await super().generate(payload)


class MalformedWorker(FakeWorker):
    async def generate(self, payload):
        response = await super().generate(payload)
        del response["intents"]
        return response


class BlockingWorker(FakeWorker):
    def __init__(self, *, fail: bool = False):
        super().__init__()
        self.fail = fail
        self.entered = asyncio.Event()
        self.release = asyncio.Event()

    async def generate(self, payload):
        response = await super().generate(payload)
        self.entered.set()
        await self.release.wait()
        if self.fail:
            raise UpstreamError("이미지 워커 호출에 실패했습니다")
        return response


async def test_generate_charges_tokens_without_session(client, app, db_session, settings):
    """세션 없는 generate도 과금 — 성공 시 잔액 차감 + use 원장 행."""
    worker = FakeWorker()
    app.state.worker = worker
    user = await make_user(db_session)
    await _fund(db_session, user, amount=30)

    res = await client.post(
        "/design/generate",
        json={"intent": {"x": 1}, "candidate_count": 1},
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 200
    assert len(worker.generate_payloads) == 1
    assert await ledger.get_balance(db_session, user.id) == {"total": 25, "paid": 0, "bonus": 25}


async def test_generate_insufficient_tokens_blocks_worker(client, app, db_session, settings):
    worker = FakeWorker()
    app.state.worker = worker
    user = await make_user(db_session)
    await seed_setting(db_session, *TOKEN_COST)  # 잔액 미지급

    res = await client.post(
        "/design/generate",
        json={"intent": {"x": 1}},
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "디자인 토큰이 부족합니다"
    assert worker.generate_payloads == []  # 차감 실패 시 워커 미호출


async def test_generate_worker_failure_refunds(client, app, db_session, settings):
    app.state.worker = FailingWorker()
    user = await make_user(db_session)
    await _fund(db_session, user, amount=30)

    res = await client.post(
        "/design/generate",
        json={"intent": {"x": 1}},
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 502
    # 차감 5 → 같은 free 배치로 환불 5 = 클래스까지 원복
    assert await ledger.get_balance(db_session, user.id) == {"total": 30, "paid": 0, "bonus": 30}


async def test_generate_worker_failure_keeps_staged_photo_for_same_id_retry(
    client, app, db_session, settings
):
    worker = FailOnceWorker()
    app.state.worker = worker
    user = await make_user(db_session)
    await _fund(db_session, user, amount=30)
    headers = auth_headers(user, settings)
    design_session = (await client.post("/design/sessions", headers=headers)).json()
    now = datetime.now(UTC)
    photo = Image(
        object_key="uploads/design_reference/retry.png",
        entity_type="design_reference_upload",
        entity_id="uploads/design_reference/retry.png",
        uploaded_by=user.id,
        content_type="image/png",
        size_bytes=123,
        original_filename="재시도.png",
        upload_completed_at=now,
        expires_at=now + timedelta(hours=1),
    )
    db_session.add(photo)
    await db_session.commit()
    await db_session.refresh(photo)
    body = {
        "session_id": design_session["id"],
        "prompt": "사진 색감으로 원형 패턴",
        "reference_images": [{"upload_id": str(photo.id), "purpose": "color_mood"}],
    }

    failed = await client.post("/design/generate", json=body, headers=headers)
    assert failed.status_code == 502
    await db_session.refresh(photo)
    assert photo.entity_type == "design_reference_upload"
    assert photo.expires_at is not None

    retried = await client.post("/design/generate", json=body, headers=headers)
    assert retried.status_code == 200, retried.text
    assert [payload["reference_images"] for payload in worker.generate_payloads] == [
        worker.generate_payloads[0]["reference_images"],
        worker.generate_payloads[0]["reference_images"],
    ]
    await db_session.refresh(photo)
    assert photo.entity_type == "design_reference"
    assert photo.entity_id == design_session["id"]
    assert photo.expires_at is None
    assert await ledger.get_balance(db_session, user.id) == {"total": 25, "paid": 0, "bonus": 25}


async def test_generate_malformed_worker_response_refunds(client, app, db_session, settings):
    app.state.worker = MalformedWorker()
    user = await make_user(db_session)
    await _fund(db_session, user, amount=30)

    res = await client.post(
        "/design/generate",
        json={"intent": {"x": 1}},
        headers=auth_headers(user, settings),
    )

    assert res.status_code == 502
    assert res.json() == {
        "detail": "이미지 워커 응답 형식이 올바르지 않습니다",
        "code": "upstream_error",
    }
    assert await ledger.get_balance(db_session, user.id) == {"total": 30, "paid": 0, "bonus": 30}


@respx.mock
async def test_generate_non_json_worker_response_refunds(client, app, db_session, settings):
    from api.integrations.worker import WorkerClient

    app.state.worker = WorkerClient(settings)
    respx.post(f"{settings.worker_base_url}/generate").mock(
        return_value=httpx.Response(200, text="not-json")
    )
    user = await make_user(db_session)
    await _fund(db_session, user, amount=30)

    res = await client.post(
        "/design/generate",
        json={"intent": {"x": 1}},
        headers=auth_headers(user, settings),
    )

    assert res.status_code == 502
    assert res.json()["code"] == "upstream_error"
    assert await ledger.get_balance(db_session, user.id) == {"total": 30, "paid": 0, "bonus": 30}


async def test_generate_turn_record_failure_rolls_back_and_refunds(
    client, app, db_session, settings, monkeypatch
):
    from api.domains.design import router as design_router

    app.state.worker = FakeWorker()
    user = await make_user(db_session)
    await _fund(db_session, user, amount=30)
    headers = auth_headers(user, settings)
    design_session = (await client.post("/design/sessions", headers=headers)).json()

    async def fail_append(*args, **kwargs):
        raise RuntimeError("turn write failed")

    monkeypatch.setattr(design_router, "_append_turn", fail_append)
    res = await client.post(
        "/design/generate",
        json={"session_id": design_session["id"], "prompt": "navy dots"},
        headers=headers,
    )

    assert res.status_code == 502
    assert await ledger.get_balance(db_session, user.id) == {"total": 30, "paid": 0, "bonus": 30}
    turns = (
        await client.get(f"/design/sessions/{design_session['id']}/turns", headers=headers)
    ).json()
    assert turns == []


async def test_generate_client_cancellation_still_records_turns(client, app, db_session, settings):
    worker = BlockingWorker()
    app.state.worker = worker
    user = await make_user(db_session)
    await _fund(db_session, user, amount=30)
    headers = auth_headers(user, settings)
    design_session = (await client.post("/design/sessions", headers=headers)).json()

    request_task = asyncio.create_task(
        client.post(
            "/design/generate",
            json={"session_id": design_session["id"], "prompt": "navy dots"},
            headers=headers,
        )
    )
    await asyncio.wait_for(worker.entered.wait(), timeout=2)
    request_task.cancel()
    worker.release.set()
    with pytest.raises(asyncio.CancelledError):
        await request_task

    assert await ledger.get_balance(db_session, user.id) == {"total": 25, "paid": 0, "bonus": 25}
    turns = (
        await client.get(f"/design/sessions/{design_session['id']}/turns", headers=headers)
    ).json()
    assert [turn["payload"]["type"] for turn in turns] == ["generate_request", "generate"]


async def test_generate_client_cancellation_still_refunds_worker_failure(
    client, app, db_session, settings
):
    worker = BlockingWorker(fail=True)
    app.state.worker = worker
    user = await make_user(db_session)
    await _fund(db_session, user, amount=30)
    headers = auth_headers(user, settings)
    design_session = (await client.post("/design/sessions", headers=headers)).json()

    request_task = asyncio.create_task(
        client.post(
            "/design/generate",
            json={"session_id": design_session["id"], "prompt": "navy dots"},
            headers=headers,
        )
    )
    await asyncio.wait_for(worker.entered.wait(), timeout=2)
    request_task.cancel()
    worker.release.set()
    with pytest.raises(asyncio.CancelledError):
        await request_task

    assert await ledger.get_balance(db_session, user.id) == {"total": 30, "paid": 0, "bonus": 30}
    turns = (
        await client.get(f"/design/sessions/{design_session['id']}/turns", headers=headers)
    ).json()
    assert turns == []


async def test_generate_refund_pending_has_specific_error(client, app, db_session, settings):
    worker = FakeWorker()
    app.state.worker = worker
    user = await make_user(db_session)
    await _fund(db_session, user, amount=30)
    await make_token_refund_claim(db_session, user)

    response = await client.post(
        "/design/generate",
        json={"prompt": "navy dots"},
        headers=auth_headers(user, settings),
    )

    assert response.status_code == 400
    assert response.json() == {
        "detail": "환불 심사 중에는 생성할 수 없습니다",
        "code": "refund_pending",
    }
    assert worker.generate_payloads == []


# ---- 모티프 프록시 + recraft 예산 (P5) ----


class MotifWorker(FakeWorker):
    def __init__(self, *, reused=False, fail=False):
        super().__init__()
        self.reused = reused
        self.fail = fail
        self.motif_calls = []

    async def motif_candidates(self, payload):
        self.motif_calls.append(("candidates", payload))
        return {
            "request_id": "rid-worker",
            "registry_version": "0.1.0",
            "candidates": [
                {"motif_id": "recraft-abc123def456", "similarity": 0.91, "scope": "whole"}
            ],
        }

    async def motif_generate(self, payload):
        if self.fail:
            raise UpstreamError("이미지 워커 호출에 실패했습니다")
        self.motif_calls.append(("generate", payload))
        return {
            "request_id": "rid-worker",
            "motif_id": "recraft-abc123def456",
            "reused": self.reused,
            "similarity": None if not self.reused else 1.0,
        }


async def test_seed_inputs_reject_outside_signed_int64_before_db_or_worker(
    client, app, db_session, settings
):
    worker = MotifWorker()
    app.state.worker = worker
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    design_session = (await client.post("/design/sessions", headers=headers)).json()
    session_id = design_session["id"]

    session_update = await client.patch(
        f"/design/sessions/{session_id}",
        json={"seed": SIGNED_INT64_MAX + 1},
        headers=headers,
    )
    generate = await client.post(
        "/design/generate",
        json={"prompt": "navy dots", "seed": SIGNED_INT64_MIN - 1},
        headers=headers,
    )
    motif = await client.post(
        f"/design/sessions/{session_id}/motifs/generate",
        json={
            "spec": {"subject": "flower", "scope": "whole"},
            "seed": SIGNED_INT64_MAX + 1,
        },
        headers=headers,
    )

    assert session_update.status_code == generate.status_code == motif.status_code == 422
    persisted = await db_session.get(DesignSession, uuid.UUID(session_id))
    assert persisted is not None
    await db_session.refresh(persisted)
    assert persisted.seed is None
    assert persisted.recraft_used == 0
    assert worker.generate_payloads == []
    assert worker.motif_calls == []


async def _session_recraft_used(client, headers, sid):
    return (await client.get(f"/design/sessions/{sid}", headers=headers)).json()["recraft_used"]


async def test_motif_candidates_proxy_no_budget(client, app, db_session, settings):
    app.state.worker = MotifWorker()
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    sid = (await client.post("/design/sessions", headers=headers)).json()["id"]

    res = await client.post(
        f"/design/sessions/{sid}/motifs/candidates",
        json={"spec": {"subject": "flower", "scope": "whole"}},
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["candidates"][0]["motif_id"] == "recraft-abc123def456"
    assert await _session_recraft_used(client, headers, sid) == 0  # read-only — 예산 무관


async def test_motif_generate_budget_exhaustion(client, app, db_session, settings):
    """생성(reused=False) 3회 후 4회째 409 — 조건부 UPDATE 예산."""
    app.state.worker = MotifWorker(reused=False)
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    sid = (await client.post("/design/sessions", headers=headers)).json()["id"]
    body = {"spec": {"subject": "flower", "scope": "whole"}}

    for _ in range(3):
        res = await client.post(
            f"/design/sessions/{sid}/motifs/generate", json=body, headers=headers
        )
        assert res.status_code == 200
    assert await _session_recraft_used(client, headers, sid) == 3

    blocked = await client.post(
        f"/design/sessions/{sid}/motifs/generate", json=body, headers=headers
    )
    assert blocked.status_code == 409
    assert blocked.json()["code"] == "recraft_budget_exhausted"


async def test_motif_generate_reused_refunds_budget(client, app, db_session, settings):
    """래더 히트(reused=True)는 Recraft 미호출 — 예산 원복."""
    app.state.worker = MotifWorker(reused=True)
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    sid = (await client.post("/design/sessions", headers=headers)).json()["id"]

    res = await client.post(
        f"/design/sessions/{sid}/motifs/generate",
        json={"spec": {"subject": "flower", "scope": "whole"}},
        headers=headers,
    )
    assert res.status_code == 200 and res.json()["reused"] is True
    assert await _session_recraft_used(client, headers, sid) == 0


async def test_motif_generate_worker_failure_refunds_budget(client, app, db_session, settings):
    app.state.worker = MotifWorker(fail=True)
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    sid = (await client.post("/design/sessions", headers=headers)).json()["id"]

    res = await client.post(
        f"/design/sessions/{sid}/motifs/generate",
        json={"spec": {"subject": "flower", "scope": "whole"}},
        headers=headers,
    )
    assert res.status_code == 502
    assert await _session_recraft_used(client, headers, sid) == 0


# ---- 워커 오류 status 구분 (요청 오류 422 vs 일시 장애 502 — 둘 다 환불) ----


class RejectingWorker(FakeWorker):
    async def generate(self, payload):
        raise WorkerRequestError(
            "디자인 구성을 만들지 못했습니다",
            code="authoring_invalid",
            stage="authoring",
        )


async def test_generate_worker_rejection_returns_422_and_refunds(client, app, db_session, settings):
    app.state.worker = RejectingWorker()
    user = await make_user(db_session)
    await _fund(db_session, user, amount=30)

    res = await client.post(
        "/design/generate",
        json={"intent": {"x": 1}},
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 422
    assert res.json() == {
        "code": "authoring_invalid",
        "stage": "authoring",
        "detail": "디자인 구성을 만들지 못했습니다",
    }
    assert await ledger.get_balance(db_session, user.id) == {"total": 30, "paid": 0, "bonus": 30}


async def test_generate_candidate_count_bounds_reject_before_charge(
    client, app, db_session, settings
):
    worker = FakeWorker()
    app.state.worker = worker
    user = await make_user(db_session)
    await _fund(db_session, user, amount=30)

    res = await client.post(
        "/design/generate",
        json={"intent": {"x": 1}, "candidate_count": 9},
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 422
    assert worker.generate_payloads == []  # 워커 미호출
    # 검증이 과금보다 먼저 — 차감 자체가 없어 잔액 원형 유지
    assert await ledger.get_balance(db_session, user.id) == {"total": 30, "paid": 0, "bonus": 30}


async def test_design_input_size_bounds_reject_before_worker_or_persistence(
    client, app, db_session, settings
):
    worker = FakeWorker()
    app.state.worker = worker
    user = await make_user(db_session)
    await _fund(db_session, user, amount=30)
    headers = auth_headers(user, settings)
    session_id = (await client.post("/design/sessions", headers=headers)).json()["id"]

    prompt = await client.post(
        "/design/generate",
        json={"prompt": "가" * (MAX_DESIGN_PROMPT_LENGTH + 1)},
        headers=headers,
    )
    turn = await client.post(
        f"/design/sessions/{session_id}/turns",
        json={"role": "user", "payload": {"blob": "x" * MAX_DESIGN_JSON_BYTES}},
        headers=headers,
    )
    non_finite_responses = [
        await client.post(
            "/design/generate",
            content=f'{{"intent":{{"weight":{literal}}}}}',
            headers={**headers, "Content-Type": "application/json"},
        )
        for literal in ("NaN", "Infinity", "-Infinity")
    ]

    assert prompt.status_code == 422
    assert turn.status_code == 422
    assert all(response.status_code == 422 for response in non_finite_responses)
    assert worker.generate_payloads == []
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(DesignSessionTurn)
            .where(DesignSessionTurn.session_id == uuid.UUID(session_id))
        )
        == 0
    )
    assert await ledger.get_balance(db_session, user.id) == {"total": 30, "paid": 0, "bonus": 30}


@respx.mock
async def test_worker_client_maps_statuses(settings):
    from api.integrations.worker import WorkerClient

    wc = WorkerClient(settings)
    route = respx.post(f"{settings.worker_base_url}/generate")

    route.mock(return_value=httpx.Response(422, json={"detail": "invalid intent"}))
    with pytest.raises(WorkerRequestError, match="이미지 생성 요청") as legacy:
        await wc.generate({})
    assert legacy.value.code == "worker_rejected"

    route.mock(return_value=httpx.Response(422, json=["invalid intent list"]))
    with pytest.raises(WorkerRequestError, match="이미지 생성 요청"):
        await wc.generate({})

    route.mock(
        return_value=httpx.Response(
            422,
            json={
                "detail": {
                    "code": "constraint_conflict",
                    "stage": "constraints",
                    "message": "internal detail is ignored",
                }
            },
        )
    )
    with pytest.raises(WorkerRequestError, match="설정을 함께 적용") as structured:
        await wc.generate({})
    assert structured.value.code == "constraint_conflict"
    assert structured.value.stage == "constraints"

    route.mock(
        return_value=httpx.Response(
            422,
            json={
                "detail": {
                    "code": "semantic_mismatch",
                    "stage": "authoring",
                    "message": "internal detail is ignored",
                }
            },
        )
    )
    with pytest.raises(WorkerRequestError, match="요청한 주제") as semantic:
        await wc.generate({})
    assert semantic.value.code == "semantic_mismatch"
    assert semantic.value.stage == "authoring"

    route.mock(return_value=httpx.Response(503, text="unavailable"))
    with pytest.raises(UpstreamError):
        await wc.generate({})

    # 타임아웃·커넥션 등 transport 오류도 UpstreamError(→ 환불 경로)로 접힌다
    route.mock(side_effect=httpx.ConnectTimeout("boom"))
    with pytest.raises(UpstreamError):
        await wc.generate({})

    route.mock(return_value=httpx.Response(200, text="not-json"))
    with pytest.raises(UpstreamError, match="응답을 해석"):
        await wc.generate({})

    route.mock(return_value=httpx.Response(200, json=[]))
    with pytest.raises(UpstreamError, match="응답 형식"):
        await wc.generate({})

    route.mock(return_value=httpx.Response(200, json={"ok": True}))
    assert await wc.generate({}) == {"ok": True}
    await wc.aclose()


@respx.mock
async def test_worker_client_routes_design_helpers(settings):
    from api.integrations.worker import WorkerClient

    routes = {
        "/palette/extract": {"colors": ["#000000", "#FFFFFF"]},
        "/motifs/text-preview": {"svg": "<svg/>"},
        "/motifs/photo-preview": {"svg": "<svg/>", "warnings": []},
        "/ideas": {"ideas": ["a", "b", "c"]},
    }
    mocks = {
        path: respx.post(f"{settings.worker_base_url}{path}").mock(
            return_value=httpx.Response(200, json=response)
        )
        for path, response in routes.items()
    }
    wc = WorkerClient(settings)

    assert await wc.palette_extract({"image": {}}) == routes["/palette/extract"]
    assert await wc.motif_text_preview({"text": "A"}) == routes["/motifs/text-preview"]
    assert await wc.motif_photo_preview({"image": {}}) == routes["/motifs/photo-preview"]
    assert await wc.ideas({"prompt": "x"}) == routes["/ideas"]
    assert all(route.called for route in mocks.values())
    await wc.aclose()


@respx.mock
async def test_worker_client_maps_malformed_oidc_token(settings):
    from api.integrations.worker import _METADATA_IDENTITY_URL, WorkerClient

    settings.worker_oidc_audience = "worker-audience"
    wc = WorkerClient(settings)
    metadata = respx.get(
        _METADATA_IDENTITY_URL,
        params__contains={"audience": "worker-audience"},
    ).mock(return_value=httpx.Response(200, text="not-a-jwt"))

    with pytest.raises(UpstreamError, match="인증 토큰 형식"):
        await wc.generate({})

    assert metadata.called
    await wc.aclose()


@respx.mock
async def test_worker_client_separates_generate_and_finalize_audiences(settings):
    from api.integrations.worker import _METADATA_IDENTITY_URL, WorkerClient

    settings.worker_base_url = "https://worker-generate.test"
    settings.worker_finalize_url = "https://worker-finalize.test"
    settings.worker_oidc_audience = "generate-audience"
    settings.worker_finalize_oidc_audience = "finalize-audience"

    def token(audience: str) -> str:
        payload = (
            base64.urlsafe_b64encode(
                json.dumps(
                    {
                        "aud": audience,
                        "exp": (datetime.now(UTC) + timedelta(hours=1)).timestamp(),
                    }
                ).encode()
            )
            .decode()
            .rstrip("=")
        )
        return f"e30.{payload}.signature"

    generate_token = token("generate-audience")
    finalize_token = token("finalize-audience")
    generate_metadata = respx.get(
        _METADATA_IDENTITY_URL, params__contains={"audience": "generate-audience"}
    ).mock(return_value=httpx.Response(200, text=generate_token))
    finalize_metadata = respx.get(
        _METADATA_IDENTITY_URL, params__contains={"audience": "finalize-audience"}
    ).mock(return_value=httpx.Response(200, text=finalize_token))
    generate = respx.post("https://worker-generate.test/generate").mock(
        return_value=httpx.Response(200, json={"ok": True})
    )
    export = respx.post("https://worker-finalize.test/export").mock(
        return_value=httpx.Response(200, content=b"png", headers={"content-type": "image/png"})
    )
    finalize = respx.post("https://worker-finalize.test/tasks/finalize").mock(
        return_value=httpx.Response(200, json={"status": "succeeded"})
    )
    wc = WorkerClient(settings)

    assert await wc.generate({}) == {"ok": True}
    assert await wc.export({"svg": "<svg/>"}) == (b"png", "image/png")
    assert await wc.finalize_job("job-id") == {"status": "succeeded"}

    assert generate.called and export.called and finalize.called
    assert generate.calls.last.request.headers["Authorization"].endswith(generate_token)
    assert export.calls.last.request.headers["Authorization"].endswith(finalize_token)
    assert generate_metadata.call_count == 1
    assert finalize_metadata.call_count == 1  # export와 finalize가 audience별 캐시를 공유
    await wc.aclose()


# ---- /design/export (워커 프록시 — 과금 없음, 소유자 인가) ----


async def test_export_returns_binary_without_charge(client, app, db_session, settings):
    worker = FakeWorker()
    app.state.worker = worker
    user = await make_user(db_session)  # 잔액 0 — 과금 없음을 겸증

    res = await client.post(
        "/design/export",
        json={"svg": "<svg/>", "format": "png", "dpi": 300, "width_mm": 48},
        headers=auth_headers(user, settings),
    )
    assert res.status_code == 200
    assert res.content == b"png-bytes"
    assert res.headers["content-type"].startswith("image/png")
    assert worker.export_payloads == [
        {"svg": "<svg/>", "format": "png", "dpi": 300, "width_mm": 48.0}
    ]  # session_id/None 필드는 워커로 전달하지 않음


async def test_export_requires_session_ownership(client, app, db_session, settings):
    app.state.worker = FakeWorker()
    owner = await make_user(db_session)
    other = await make_user(db_session)
    created = await client.post("/design/sessions", json={}, headers=auth_headers(owner, settings))
    session_id = created.json()["id"]

    res = await client.post(
        "/design/export",
        json={"session_id": session_id, "svg": "<svg/>", "width_mm": 48},
        headers=auth_headers(other, settings),
    )
    assert res.status_code == 403  # 남의 세션 — 워커 미호출

    ok = await client.post(
        "/design/export",
        json={"session_id": session_id, "svg": "<svg/>", "width_mm": 48},
        headers=auth_headers(owner, settings),
    )
    assert ok.status_code == 200


@respx.mock
async def test_worker_client_export_maps_statuses(settings):
    from api.integrations.worker import WorkerClient

    wc = WorkerClient(settings)
    route = respx.post(f"{settings.worker_base_url}/export")

    route.mock(
        return_value=httpx.Response(200, content=b"tif", headers={"content-type": "image/tiff"})
    )
    assert await wc.export({"svg": "<svg/>"}) == (b"tif", "image/tiff")

    route.mock(return_value=httpx.Response(400, json={"detail": "dpi must be <= 600"}))
    with pytest.raises(WorkerRequestError, match="dpi must be"):
        await wc.export({"svg": "<svg/>"})
    await wc.aclose()

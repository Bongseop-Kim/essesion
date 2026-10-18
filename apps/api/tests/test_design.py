"""디자인 세션 — 템플릿 세션의 로고 교체, 사진→로고 미리보기, 세션 조회, 워커 클라이언트."""

import base64
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx
from api.config import Settings
from api.domains.design.router import _intent_slot_motif_ids
from api.errors import UpstreamError, WorkerRequestError
from api.integrations.gcs import public_asset_url
from db.models.design import DesignExample, DesignSession, DesignSessionTurn, UserMotif
from db.models.images import Image
from db.models.seamless import Motif, SeamlessGenerationLog
from sqlalchemy import select

from .factories import auth_headers, make_user
from .fakes import simulate_uploads


class FakeWorker:
    def __init__(self, sessionmaker=None):
        self.sessionmaker = sessionmaker
        self.generate_payloads = []
        self.motif_import_payloads = []
        self.photo_preview_payloads = []

    async def generate(self, payload):
        self.generate_payloads.append(payload)
        run_id = payload["run_id"]
        response = {
            "generation_log_id": run_id,
            "request_id": "rid-worker",
            "registry_version": "0.1.0",
            "engine_version": "0.1.0",
            "intent": payload["intent"],
            "plan": None,
            "warnings": [],
            "design": {
                "id": "design-1",
                "layout_id": "layout-1",
                "source_fidelity": "vector",
                "colorway_id": "default",
                "seed": 7,
                "svg": "<svg/>",
                "png_object_key": "previews/rid-worker/design-1.png",
            },
        }
        if self.sessionmaker is not None:
            async with self.sessionmaker() as session:
                session.add(
                    SeamlessGenerationLog(
                        id=uuid.UUID(str(run_id)),
                        request_id=response["request_id"],
                        input_type="intent",
                        seed=payload.get("seed"),
                        engine_version=response["engine_version"],
                        registry_version=response["registry_version"],
                        intent={"design": payload["intent"]},
                        design={**response["design"], "intent": payload["intent"]},
                        warnings=[],
                        status="success",
                    )
                )
                await session.commit()
        return response

    async def motif_import(self, payload):
        self.motif_import_payloads.append(payload)
        return {
            "motif_id": "upload-a1b2c3d4e5f6",
            "symbol": (
                '<symbol id="motif-upload-a1b2c3d4e5f6" viewBox="-0.5 -0.5 1 1">'
                '<circle cx="0" cy="0" r="0.4" fill="#123456"/></symbol>'
            ),
            "bbox": [-0.5, -0.5, 0.5, 0.5],
            "anchor": [0, 0],
            "preview_svg": "<svg/>",
        }

    async def motif_photo_preview(self, payload):
        self.photo_preview_payloads.append(payload)
        return {
            "svg": '<svg viewBox="0 0 1 1"><path d="M0 0H1V1Z"/></svg>',
            "warnings": [],
            "background_confidence": 0.9,
            "processed_preview_base64": base64.b64encode(b"\x89PNG\r\n\x1a\npreview").decode(),
        }

    async def aclose(self):
        pass


def _logo_session(user_id: uuid.UUID) -> DesignSession:
    design_session = DesignSession(user_id=user_id)
    design_session.current_intent = {
        "canvas": {"tile_mm": 24},
        "palette": {"slots": []},
        "colorways": [],
        "layers": [
            {"id": "m0", "type": "motif", "z_order": 0, "params": {"motif_id": "seed-dots"}}
        ],
    }
    return design_session


async def test_session_reports_pointer_svg(client, db_session, settings):
    """색·로고 화면은 편집 포인터(마지막 activate 턴)의 런 SVG를 그린다."""
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    pointed = DesignSession(user_id=user.id)
    empty = DesignSession(user_id=user.id)
    db_session.add_all([pointed, empty])
    await db_session.flush()
    run_id = uuid.uuid4()
    db_session.add(
        SeamlessGenerationLog(
            id=run_id,
            input_type="intent",
            design={"svg": "<svg id='pointer'/>", "panel_svg": "<svg id='panel'/>"},
            status="success",
        )
    )
    db_session.add(
        DesignSessionTurn(
            session_id=pointed.id,
            seq=1,
            role="user",
            payload={
                "type": "activate",
                "run_id": str(run_id),
                "seed": 7,
                "colorway_id": "default",
            },
        )
    )
    await db_session.commit()

    single = (await client.get(f"/design/sessions/{pointed.id}", headers=headers)).json()
    assert single["preview_svg"] == "<svg id='pointer'/>"
    assert single["preview_panel_svg"] == "<svg id='panel'/>"
    blank = (await client.get(f"/design/sessions/{empty.id}", headers=headers)).json()
    assert blank["preview_svg"] is None
    other = await make_user(db_session)
    denied = await client.get(
        f"/design/sessions/{pointed.id}", headers=auth_headers(other, settings)
    )
    assert denied.status_code == 403


async def test_session_reports_current_motifs_including_catalog(client, db_session, settings):
    """좌측 모티프 패널 데이터 — 내 라이브러리 이름은 그대로, 카탈로그는 이름 없이 나온다."""
    user = await make_user(db_session)
    mine = Motif(
        id="upload-333333333333",
        symbol=(
            '<symbol id="motif-upload-333333333333" viewBox="-0.5 -0.5 1 1">'
            '<circle cx="0" cy="0" r="0.4" fill="#123456"/></symbol>'
        ),
        bbox=[-0.5, -0.5, 0.5, 0.5],
        anchor=[0, 0],
        source="user_upload",
    )
    catalog = Motif(
        id="seed-bee",
        symbol=(
            '<symbol id="motif-seed-bee" viewBox="-0.5 -0.5 1 1">'
            '<rect x="-0.3" y="-0.3" width="0.6" height="0.6" fill="#123456"/></symbol>'
        ),
        bbox=[-0.5, -0.5, 0.5, 0.5],
        anchor=[0, 0],
        source="catalog",
    )
    design_session = DesignSession(user_id=user.id)
    design_session.current_intent = {
        "canvas": {"tile_mm": 24},
        "palette": {"slots": []},
        "colorways": [],
        "layers": [
            {"id": "bg", "type": "background", "z_order": 0, "params": {"color": "ground"}},
            {"id": "m0", "type": "motif", "z_order": 1, "params": {"motif_id": catalog.id}},
            {"id": "m1", "type": "motif", "z_order": 2, "params": {"motif_id": mine.id}},
        ],
    }
    db_session.add_all([mine, catalog, design_session])
    await db_session.flush()
    db_session.add(UserMotif(user_id=user.id, motif_id=mine.id, name="내 원형"))
    await db_session.commit()
    headers = auth_headers(user, settings)

    fetched = (await client.get(f"/design/sessions/{design_session.id}", headers=headers)).json()

    # 레이어 순서 유지, 최대 2개 — 카탈로그 모티프도 포함된다.
    assert [motif["motif_id"] for motif in fetched["current_motifs"]] == [catalog.id, mine.id]
    assert [motif["name"] for motif in fetched["current_motifs"]] == [None, "내 원형"]
    assert all(
        f'href="#motif-{motif["motif_id"]}"' in motif["preview_svg"]
        for motif in fetched["current_motifs"]
    )


async def test_logo_saves_motif_once_and_activates_server_chosen_slot(
    client, app, db_session, settings
):
    """로고 한 번에 넣기 — 내 모티프 저장(멱등) + 슬롯 교체 재렌더. 무과금, 슬롯은 서버가 정한다."""
    worker = FakeWorker(sessionmaker=app.state.sessionmaker)
    app.state.worker = worker
    user = await make_user(db_session)
    other = await make_user(db_session)
    headers = auth_headers(user, settings)
    design_session = DesignSession(user_id=user.id)
    design_session.current_intent = {
        "canvas": {"tile_mm": 24},
        "palette": {"slots": []},
        "colorways": [],
        "layers": [
            {"id": "m0", "type": "motif", "z_order": 0, "params": {"motif_id": "seed-dots"}},
            {"id": "m1", "type": "motif", "z_order": 1, "params": {"motif_id": "seed-bee"}},
        ],
    }
    design_session.seed = 7
    db_session.add(design_session)
    await db_session.commit()
    sid = str(design_session.id)
    body = {"name": "acme", "svg": "<svg id='logo'/>"}

    denied = await client.post(
        f"/design/sessions/{sid}/logo", json=body, headers=auth_headers(other, settings)
    )
    assert denied.status_code == 403
    assert worker.motif_import_payloads == []

    first = await client.post(f"/design/sessions/{sid}/logo", json=body, headers=headers)
    second = await client.post(f"/design/sessions/{sid}/logo", json=body, headers=headers)
    assert first.status_code == second.status_code == 200, first.text
    # 두 모티프 템플릿 — 큰 무늬인 2번 슬롯에 넣는다(서버 규칙).
    for payload in worker.generate_payloads[-2:]:
        assert payload["motif_slot"] == {"slot": 2, "motif_id": "upload-a1b2c3d4e5f6"}
        assert payload["seed"] == 7
        assert payload["session_id"] == sid and payload["user_id"] == str(user.id)
    links = list(await db_session.scalars(select(UserMotif).where(UserMotif.user_id == user.id)))
    assert len(links) == 1 and links[0].name == "acme"
    stored = await db_session.get(Motif, "upload-a1b2c3d4e5f6")
    assert stored is not None and stored.source == "user_upload"

    # 진행 중이면 저장도 하지 않고 409.
    persisted = await db_session.get(DesignSession, design_session.id)
    assert persisted is not None
    await db_session.refresh(persisted)
    persisted.active_generation_id = uuid.uuid4()
    persisted.active_generation_started_at = datetime.now(UTC)
    await db_session.commit()
    imports_before = len(worker.motif_import_payloads)
    busy = await client.post(f"/design/sessions/{sid}/logo", json=body, headers=headers)
    assert busy.status_code == 409
    assert busy.json()["code"] == "generation_in_progress"
    assert len(worker.motif_import_payloads) == imports_before

    # 렌더 도중 죽어 남은 오래된 진행 표시는 풀고 로고를 넣는다 — 영구 409 방지.
    await db_session.refresh(persisted)
    persisted.active_generation_started_at = datetime.now(UTC) - timedelta(hours=3)
    await db_session.commit()
    recovered = await client.post(f"/design/sessions/{sid}/logo", json=body, headers=headers)
    assert recovered.status_code == 200, recovered.text

    # 모티프 레이어가 하나면 1번 슬롯.
    single = DesignSession(user_id=user.id)
    single.current_intent = {
        "canvas": {"tile_mm": 24},
        "palette": {"slots": []},
        "colorways": [],
        "layers": [
            {"id": "m0", "type": "motif", "z_order": 0, "params": {"motif_id": "seed-dots"}}
        ],
    }
    db_session.add(single)
    await db_session.commit()
    res = await client.post(f"/design/sessions/{single.id}/logo", json=body, headers=headers)
    assert res.status_code == 200, res.text
    assert worker.generate_payloads[-1]["motif_slot"]["slot"] == 1

    # 템플릿에서 시작한 세션은 템플릿의 logo_slots를 따른다 — 생략하면 첫 자리, 고르면 그 자리.
    log = SeamlessGenerationLog(
        input_type="intent",
        registry_version="0.1.0",
        engine_version="0.1.0",
        intent={},
        design={"svg": "<svg/>"},
        status="success",
    )
    db_session.add(log)
    await db_session.flush()
    example = DesignExample(
        run_id=log.id,
        name="템플릿",
        logo_slots=[{"slot": 1, "label": "로고"}, {"slot": 2, "label": "작은 무늬"}],
        published=True,
    )
    db_session.add(example)
    await db_session.flush()
    templated = DesignSession(user_id=user.id, example_id=example.id)
    templated.current_intent = design_session.current_intent
    db_session.add(templated)
    await db_session.commit()
    res = await client.post(f"/design/sessions/{templated.id}/logo", json=body, headers=headers)
    assert res.status_code == 200, res.text
    assert worker.generate_payloads[-1]["motif_slot"]["slot"] == 1
    res = await client.post(
        f"/design/sessions/{templated.id}/logo", json={**body, "slot": 2}, headers=headers
    )
    assert res.status_code == 200, res.text
    assert worker.generate_payloads[-1]["motif_slot"]["slot"] == 2
    # 템플릿에 없는 자리는 저장도 하지 않고 422.
    imports_before = len(worker.motif_import_payloads)
    res = await client.post(
        f"/design/sessions/{templated.id}/logo", json={**body, "slot": "logo"}, headers=headers
    )
    assert res.status_code == 422 and res.json()["code"] == "invalid_logo_slot"
    assert len(worker.motif_import_payloads) == imports_before

    # 템플릿이 자리를 안 정했고 배치형(panel) 포인트 로고가 있으면 그 자리.
    placed = DesignSession(user_id=user.id)
    placed.current_intent = {
        **(design_session.current_intent or {}),
        "panel": [
            {
                "type": "motif",
                "motif_id": "seed-crest",
                "at": [890, 980],
                "size": 140,
                "role": "logo",
            }
        ],
    }
    db_session.add(placed)
    await db_session.commit()
    res = await client.post(f"/design/sessions/{placed.id}/logo", json=body, headers=headers)
    assert res.status_code == 200, res.text
    assert worker.generate_payloads[-1]["motif_slot"] == {
        "slot": "logo",
        "motif_id": "upload-a1b2c3d4e5f6",
    }
    turns = await db_session.scalars(
        select(DesignSessionTurn).where(DesignSessionTurn.session_id == placed.id)
    )
    assert any(turn.payload.get("slot") == "logo" for turn in turns)


async def test_logo_quota_failure_does_not_persist_ownerless_motif(
    client, app, db_session, settings
):
    worker = FakeWorker()
    app.state.worker = worker
    user = await make_user(db_session)
    motif_ids = [f"upload-{index:012x}" for index in range(100)]
    db_session.add_all(
        [
            Motif(
                id=motif_id,
                symbol=(
                    f'<symbol id="motif-{motif_id}" viewBox="-0.5 -0.5 1 1">'
                    '<circle cx="0" cy="0" r="0.4" fill="#123456"/></symbol>'
                ),
                bbox=[-0.5, -0.5, 0.5, 0.5],
                anchor=[0, 0],
                source="user_upload",
            )
            for motif_id in motif_ids
        ]
    )
    design_session = _logo_session(user.id)
    db_session.add(design_session)
    await db_session.flush()
    db_session.add_all(
        [
            UserMotif(user_id=user.id, motif_id=motif_id, name=f"모티프 {index + 1}")
            for index, motif_id in enumerate(motif_ids)
        ]
    )
    await db_session.commit()

    response = await client.post(
        f"/design/sessions/{design_session.id}/logo",
        json={"name": "101번째", "svg": "<svg/>"},
        headers=auth_headers(user, settings),
    )

    assert response.status_code == 409
    assert response.json()["code"] == "user_motif_limit"
    assert await db_session.get(Motif, "upload-a1b2c3d4e5f6") is None
    assert worker.generate_payloads == []


class RejectingWorker(FakeWorker):
    async def generate(self, payload):
        raise WorkerRequestError(
            "선택한 디자인 설정을 함께 적용할 수 없습니다",
            code="constraint_conflict",
            stage="constraints",
        )


async def test_logo_worker_rejection_records_error_turn_and_releases_session(
    client, app, db_session, settings
):
    """재렌더가 거절되면 422 + 오류 턴, 진행 표시를 풀어 다시 넣을 수 있다."""
    app.state.worker = RejectingWorker()
    user = await make_user(db_session)
    design_session = _logo_session(user.id)
    db_session.add(design_session)
    await db_session.commit()

    res = await client.post(
        f"/design/sessions/{design_session.id}/logo",
        json={"name": "acme", "svg": "<svg/>"},
        headers=auth_headers(user, settings),
    )

    assert res.status_code == 422
    assert res.json()["code"] == "constraint_conflict"
    await db_session.refresh(design_session)
    assert design_session.active_generation_id is None
    turns = list(
        await db_session.scalars(
            select(DesignSessionTurn)
            .where(DesignSessionTurn.session_id == design_session.id)
            .order_by(DesignSessionTurn.seq)
        )
    )
    assert [turn.payload["type"] for turn in turns] == ["motif_activate", "generate"]
    assert turns[-1].payload["status"] == "error"


async def test_photo_preview_requires_owned_staged_upload(client, app, db_session, settings):
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
    db_session.add(photo)
    await db_session.commit()
    await simulate_uploads(app)
    owner_headers = auth_headers(owner, settings)

    photo_preview = await client.post(
        "/design/motifs/photo-preview", json={"upload_id": str(photo.id)}, headers=owner_headers
    )
    assert photo_preview.status_code == 200
    assert photo_preview.json()["background_confidence"] == 0.9
    assert photo_preview.json()["processed_preview_base64"]
    assert set(worker.photo_preview_payloads[-1]) == {"image"}
    assert set(worker.photo_preview_payloads[-1]["image"]) == {"url", "content_type", "size_bytes"}

    removed_photo_options = await client.post(
        "/design/motifs/photo-preview",
        json={"upload_id": str(photo.id), "color_count": 3, "simplification": "low"},
        headers=owner_headers,
    )
    assert removed_photo_options.status_code == 422

    response = await client.post(
        "/design/motifs/photo-preview",
        json={"upload_id": str(photo.id)},
        headers=auth_headers(other, settings),
    )
    assert response.status_code == 409
    assert response.json()["code"] == "invalid_design_reference"


@respx.mock
async def test_worker_client_maps_statuses(settings):
    from api.integrations.worker import WorkerClient

    wc = WorkerClient(settings)
    route = respx.post(f"{settings.worker_base_url}/generate")

    route.mock(return_value=httpx.Response(422, json={"detail": "invalid intent"}))
    with pytest.raises(WorkerRequestError, match="이미지 생성 요청") as rejected:
        await wc.generate({})
    assert rejected.value.code == "worker_rejected"

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
async def test_worker_client_maps_photo_rejection_codes_to_actionable_messages(settings):
    """사진 거절은 사용자가 고칠 수 있는 조건이다 — 무엇을 바꿔야 하는지 말해야 한다.

    코드를 보존하지 않으면 "배경이 고르지 않다"와 실제 결함이 같은 문구로 뭉개진다.
    """
    from api.integrations.worker import WorkerClient

    wc = WorkerClient(settings)
    route = respx.post(f"{settings.worker_base_url}/motifs/photo-preview")

    route.mock(
        return_value=httpx.Response(
            422,
            json={
                "detail": {
                    "code": "photo_background_unclear",
                    "message": "background confidence 0.42 is too low",
                }
            },
        )
    )
    with pytest.raises(WorkerRequestError, match="배경이 단색에 가까운") as unclear:
        await wc.motif_photo_preview({})
    assert unclear.value.code == "photo_background_unclear"
    # 워커의 영문 진단은 고객 응답으로 새지 않는다.
    assert "confidence" not in unclear.value.detail

    route.mock(
        return_value=httpx.Response(
            422, json={"detail": {"code": "photo_too_detailed", "message": "exceeds bytes"}}
        )
    )
    with pytest.raises(WorkerRequestError, match="색이 적은 사진"):
        await wc.motif_photo_preview({})

    # 코드 없는 422는 예전처럼 일반 문구로 남는다.
    route.mock(return_value=httpx.Response(422, json={"detail": "image could not be decoded"}))
    with pytest.raises(WorkerRequestError, match="이미지 생성 요청") as bare:
        await wc.motif_photo_preview({})
    assert bare.value.code == "worker_rejected"
    await wc.aclose()


@respx.mock
async def test_worker_client_routes_logo_helpers(settings):
    from api.integrations.worker import WorkerClient

    routes = {
        "/motifs/import": {"motif_id": "upload-a1b2c3d4e5f6"},
        "/motifs/photo-preview": {"svg": "<svg/>", "warnings": []},
    }
    mocks = {
        path: respx.post(f"{settings.worker_base_url}{path}").mock(
            return_value=httpx.Response(200, json=response)
        )
        for path, response in routes.items()
    }
    wc = WorkerClient(settings)

    assert await wc.motif_import({"svg": "<svg/>"}) == routes["/motifs/import"]
    assert await wc.motif_photo_preview({"image": {}}) == routes["/motifs/photo-preview"]
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


def test_public_asset_url_uses_project_bucket_and_quotes_key():
    settings = Settings(
        env="staging",
        public_api_origin="https://api.example.com",
        gcs_assets_bucket="configured-assets",
    )
    assert public_asset_url(settings, "fabric/a b#.png") == (
        "https://storage.googleapis.com/configured-assets/fabric/a%20b%23.png"
    )


def test_slot_motif_ids_follow_worker_slot_rule():
    """슬롯 = 같은 모티프 레이어 묶음(박힌 slot 우선) — worker `motif_layer_slots`와 같은 규칙."""

    def layer(motif_id: str, slot: int | None = None) -> dict:
        return {"type": "motif", "params": {"motif_id": motif_id}} | (
            {"slot": slot} if slot is not None else {}
        )

    # 엇갈림처럼 같은 모티프를 여러 레이어로 그려도 한 슬롯이다.
    assert _intent_slot_motif_ids(
        {"layers": [layer("wing"), layer("wing"), layer("dot"), layer("wing")]}
    ) == ["wing", "dot"]
    # 두 슬롯에 같은 로고를 넣은 뒤(worker가 slot을 박아 둠)에도 슬롯은 둘이다.
    assert _intent_slot_motif_ids({"layers": [layer("acme", 1), layer("acme", 2)]}) == [
        "acme",
        "acme",
    ]

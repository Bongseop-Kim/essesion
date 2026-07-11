"""디자인 세션 골격 — 턴 seq 직렬화·예산 카운터·generate 과금."""

import asyncio
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
import respx
from api.domains.design.router import KNOWN_WEAVES, _public_asset_url
from api.domains.tokens import ledger
from api.errors import UpstreamError, WorkerRequestError
from db.models.design import DesignSession, GenerationJob
from db.models.tokens import DesignToken

from .factories import auth_headers, make_token_refund_claim, make_user, seed_setting

_WORKER_FABRIC_ASSETS = Path(__file__).parents[2] / "worker/src/worker/render/assets/fabric"

TOKEN_COST = ("design_token_cost_openai_render_standard", "5")


async def _fund(db_session, user, amount=30):
    """generate 과금 전제 — 비용 설정 + 잔액 지급."""
    await seed_setting(db_session, *TOKEN_COST)
    db_session.add(DesignToken(user_id=user.id, amount=amount, type="grant", token_class="free"))
    await db_session.commit()


class FakeWorker:
    def __init__(self):
        self.generate_payloads = []
        self.finalize_jobs = []
        self.export_payloads = []

    async def generate(self, payload):
        self.generate_payloads.append(payload)
        resolved_intent = payload.get("intent") or {
            "canvas": {"tile_mm": 24},
            "layers": [],
            "palette": {"slots": []},
            "colorways": [],
        }
        return {
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

    async def aclose(self):
        pass


async def test_session_lifecycle_and_turns(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)

    session = (await client.post("/design/sessions", headers=headers)).json()
    assert session["status"] == "active"
    assert session["recraft_used"] == 0 and session["finalize_used"] == 0

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


async def test_generate_and_finalize_job(client, app, db_session, settings):
    app.state.worker = FakeWorker()
    user = await make_user(db_session)
    await _fund(db_session, user)
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


async def test_prompt_generate_select_and_finalize(client, app, db_session, settings):
    app.state.worker = FakeWorker()
    user = await make_user(db_session)
    await _fund(db_session, user)
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


def test_public_asset_url_uses_project_bucket_and_quotes_key():
    assert _public_asset_url("test-project", "fabric/a b#.png") == (
        "https://storage.googleapis.com/test-project-assets/fabric/a%20b%23.png"
    )
    assert _public_asset_url("", "fabric/a.png") is None
    assert _public_asset_url("test-project", "") is None


async def test_list_generation_jobs_filters_owner_kind_status_session_and_paginates(
    client, db_session, settings
):
    settings.gcp_project_id = "test-project"
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
    db_session.add_all(
        [older, newer, newest_other_session, failed, exported, other_job]
    )
    await db_session.commit()

    headers = auth_headers(owner, settings)
    all_jobs = (await client.get("/design/jobs", headers=headers)).json()
    assert [job["id"] for job in all_jobs] == [
        str(failed.id),
        str(newest_other_session.id),
        str(newer.id),
        str(older.id),
    ]
    assert all_jobs[2]["result_url"] == (
        "https://storage.googleapis.com/test-project-assets/fabric/newer%20file.png"
    )

    succeeded_jobs = (
        await client.get("/design/jobs?status=succeeded", headers=headers)
    ).json()
    assert [job["id"] for job in succeeded_jobs] == [
        str(newest_other_session.id),
        str(newer.id),
        str(older.id),
    ]

    page = (
        await client.get(
            "/design/jobs?status=succeeded&limit=1&offset=1", headers=headers
        )
    ).json()
    assert [job["id"] for job in page] == [str(newer.id)]

    by_session = (
        await client.get(
            f"/design/jobs?session_id={owner_session_b.id}", headers=headers
        )
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
    response = await client.post(
        f"/design/jobs/{job.id}/order-reference", headers=headers
    )
    assert response.status_code == 200
    destination = response.json()["object_key"]
    prefix = f"uploads/custom_order/design-{job.id}-"
    assert destination.startswith(prefix)
    assert destination.endswith(".png")
    assert len(destination.removeprefix(prefix).removesuffix(".png")) == 32
    assert response.json() == {"object_key": destination}
    assert app.state.gcs.copied == [
        ("test-project-assets", "fabric/result.png", destination)
    ]

    repeated = await client.post(
        f"/design/jobs/{job.id}/order-reference", headers=headers
    )
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

    invalid = await client.post(
        f"/design/jobs/{invalid_job.id}/order-reference", headers=headers
    )
    assert invalid.status_code == 409

    forbidden = await client.post(
        f"/design/jobs/{job.id}/order-reference",
        headers=auth_headers(other, settings),
    )
    assert forbidden.status_code == 403


def test_known_weaves_match_worker_assets():
    """api의 얕은 weave 사전검증 상수는 워커 에셋 stem과 정확히 일치해야 한다 —
    어긋나면 유효한 weave가 400되거나 잘못된 weave가 예산을 태운다."""
    stems = sorted(p.stem for p in _WORKER_FABRIC_ASSETS.glob("*.png"))
    assert sorted(KNOWN_WEAVES) == stems


async def test_finalize_forwards_texture_params(client, app, db_session, settings):
    """yarn_dyed 텍스처 4필드가 job.params로 전달되고, None 필드는 빠진다."""
    app.state.worker = FakeWorker()
    user = await make_user(db_session)
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
    # 차감 5 → 환불 5 = 총액 원복 (환불은 명세상 paid 클래스 적립 — money.md §6)
    assert await ledger.get_balance(db_session, user.id) == {"total": 30, "paid": 5, "bonus": 25}


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
    assert await ledger.get_balance(db_session, user.id) == {"total": 30, "paid": 5, "bonus": 25}


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
    assert await ledger.get_balance(db_session, user.id) == {"total": 30, "paid": 5, "bonus": 25}


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
    assert await ledger.get_balance(db_session, user.id) == {"total": 30, "paid": 5, "bonus": 25}
    turns = (
        await client.get(f"/design/sessions/{design_session['id']}/turns", headers=headers)
    ).json()
    assert turns == []


async def test_generate_client_cancellation_still_records_turns(
    client, app, db_session, settings
):
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

    assert await ledger.get_balance(db_session, user.id) == {"total": 30, "paid": 5, "bonus": 25}
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
            "이미지 워커가 요청을 거부했습니다: invalid intent: period off-grid"
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
    assert res.json()["code"] == "worker_rejected"
    assert "period off-grid" in res.json()["detail"]  # 워커 detail 보존
    assert await ledger.get_balance(db_session, user.id) == {"total": 30, "paid": 5, "bonus": 25}


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


@respx.mock
async def test_worker_client_maps_statuses(settings):
    from api.integrations.worker import WorkerClient

    wc = WorkerClient(settings)
    route = respx.post(f"{settings.worker_base_url}/generate")

    route.mock(return_value=httpx.Response(422, json={"detail": "invalid intent"}))
    with pytest.raises(WorkerRequestError, match="invalid intent"):
        await wc.generate({})

    route.mock(return_value=httpx.Response(422, json=["invalid intent list"]))
    with pytest.raises(WorkerRequestError, match="invalid intent list"):
        await wc.generate({})

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

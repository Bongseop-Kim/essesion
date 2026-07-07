"""디자인 세션 골격 — 턴 seq 직렬화·예산 카운터·generate 과금."""

import json
from pathlib import Path

import httpx
import pytest
import respx
from api.domains.design.router import KNOWN_WEAVES
from api.domains.tokens import ledger
from api.errors import UpstreamError, WorkerRequestError
from db.models.tokens import DesignToken

from .factories import auth_headers, make_user, seed_setting

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
        return {
            "request_id": "rid-worker",
            "registry_version": "0.1.0",
            "engine_version": "0.1.0",
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
    assert turns[-1]["payload"]["type"] == "generate"

    job = await client.post(
        f"/design/sessions/{design_session['id']}/finalize",
        json={"dpi": 300},
        headers=headers,
    )
    assert job.status_code == 201
    assert job.json()["status"] == "queued"

    fetched = await client.get(f"/design/jobs/{job.json()['id']}", headers=headers)
    assert fetched.json()["kind"] == "finalize"


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

    route.mock(return_value=httpx.Response(503, text="unavailable"))
    with pytest.raises(UpstreamError):
        await wc.generate({})

    route.mock(return_value=httpx.Response(200, json={"ok": True}))
    assert await wc.generate({}) == {"ok": True}
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

"""/generate 라우트 계약 — 원본 seamless-tile tests/test_api_generate.py 이식.

essesion 조정: 경로 `/generate`, 응답은 서버측 후보 계약(id/design_index/layout_id/
source_fidelity/colorway_id/seed/svg/png_object_key), 프리뷰는 GCS object key.
응답 캐시(원본의 2 테스트)는 essesion 미구현이라 제외.

픽스처: create_app() + get_session 페이크 세션 오버라이드 + rasterize_svg monkeypatch +
app.state.object_store = DryRunObjectStore(). lifespan은 돌지 않으므로 state를 직접 주입.
"""

import asyncio
import hashlib
import threading
import time

import httpx
import pytest
from fastapi.testclient import TestClient
from worker.api import routes
from worker.db import get_session
from worker.integrations import DryRunObjectStore
from worker.main import create_app
from worker.render.raster import RasterError

from .intent_helpers import mvp_intent, register_test_motifs

register_test_motifs()


class _EmptyScalars:
    def all(self):
        return []


class _FakeSession:
    """generate 라우트가 쓰는 최소 세션 — add/commit + 빈 DB 읽기(registry_version·catalog).

    DB에 모티프가 없으므로 get_motifs는 {}, fingerprint는 baseline을 반환 → 라우트는
    전역 registry 폴백(register_test_motifs)으로 렌더한다.
    """

    def add(self, obj) -> None:
        pass

    async def commit(self) -> None:
        pass

    async def scalars(self, *_args, **_kwargs):
        return _EmptyScalars()


def _configure_app(monkeypatch, *, raster_ok: bool = True):
    app = create_app()
    app.state.object_store = DryRunObjectStore()  # lifespan 미실행 — 직접 주입
    from worker.adapters import Adapters

    app.state.adapters = Adapters()  # 어댑터 미구성(DryRun)

    def _raster(svg, **kwargs):
        if not raster_ok:
            raise RasterError("raster unavailable")
        return (b"fake-png", "image/png")

    monkeypatch.setattr(routes, "rasterize_svg", _raster)

    async def _session():
        yield _FakeSession()

    app.dependency_overrides[get_session] = _session
    return app


@pytest.fixture
def client(monkeypatch):
    return TestClient(_configure_app(monkeypatch))


_CANDIDATE_KEYS = {
    "id",
    "design_index",
    "layout_id",
    "source_fidelity",
    "colorway_id",
    "seed",
    "svg",
    "png_object_key",
}


def test_generate_returns_product_shape(client):
    intent = mvp_intent()
    resp = client.post("/generate", json={"intent": intent, "candidate_count": 4})
    assert resp.status_code == 200
    body = resp.json()
    assert body["request_id"]
    assert body["engine_version"] and body["registry_version"]
    assert body["intents"] == [intent]
    assert len(body["candidates"]) == 4
    cand = body["candidates"][0]
    assert set(cand) == _CANDIDATE_KEYS
    digest = hashlib.sha256(b"fake-png").hexdigest()[:16]
    assert cand["png_object_key"] == (f"previews/{body['request_id']}/{cand['id']}/{digest}.png")


def test_candidates_are_diverse_and_deduped(client):
    resp = client.post("/generate", json={"intent": mvp_intent(), "candidate_count": 4})
    body = resp.json()
    cands = body["candidates"]
    ids = [c["id"] for c in cands]
    keys = [c["png_object_key"] for c in cands]
    assert len(set(ids)) == len(ids)  # de-dup: 후보마다 distinct id
    assert len(set(keys)) == len(keys)  # 따라서 distinct object key
    assert "diversity shortfall" not in " ".join(body["warnings"])


def test_intent_level_warnings_are_deduped(client):
    # 색역 밖 색은 후보마다 intent 경고를 낸다; 후보 전반에서 동일 메시지는 1개로 접혀야 한다.
    intent = mvp_intent()
    intent["palette"]["slots"][2]["hex"] = "#ffd700"
    intent["colorways"][0]["mapping"]["gold"] = "#ffd700"
    resp = client.post("/generate", json={"intent": intent, "candidate_count": 4})
    assert resp.status_code == 200
    w = resp.json()["warnings"]
    assert len(w) == len(set(w))  # 정확한 중복 없음
    assert sum("outside CMYK gamut" in m for m in w) == 1


def test_raster_failure_yields_null_png_key_with_warning(monkeypatch):
    client = TestClient(_configure_app(monkeypatch, raster_ok=False))
    resp = client.post("/generate", json={"intent": mvp_intent(), "candidate_count": 2})
    assert resp.status_code == 200
    body = resp.json()
    assert all(c["png_object_key"] is None for c in body["candidates"])
    assert any("preview upload skipped" in w for w in body["warnings"])


def test_preview_upload_failure_yields_null_key_without_failing_generate(monkeypatch):
    class FailingObjectStore:
        capability_mode = "real"

        async def upload_bytes(self, *_args, **_kwargs):
            raise RuntimeError("storage unavailable")

    app = _configure_app(monkeypatch)
    app.state.object_store = FailingObjectStore()

    resp = TestClient(app).post("/generate", json={"intent": mvp_intent(), "candidate_count": 2})

    assert resp.status_code == 200
    body = resp.json()
    assert all(candidate["png_object_key"] is None for candidate in body["candidates"])
    assert "preview upload skipped" in body["warnings"]


def test_request_id_propagates_to_body_and_header(client):
    resp = client.post("/generate", json={"intent": mvp_intent()})
    assert resp.json()["request_id"] == resp.headers["X-Request-ID"]


def test_request_id_echoed_from_header(client):
    resp = client.post(
        "/generate", headers={"X-Request-ID": "trace-xyz"}, json={"intent": mvp_intent()}
    )
    assert resp.json()["request_id"] == "trace-xyz"
    assert resp.headers["X-Request-ID"] == "trace-xyz"


def test_request_id_header_is_sanitized(client):
    # B3: 인바운드 X-Request-ID는 정제된다 — 무정제 값은 GCS object key에 경로 주입 가능.
    resp = client.post(
        "/generate", headers={"X-Request-ID": "bad id.with spaces"}, json={"intent": mvp_intent()}
    )
    assert resp.json()["request_id"] == "bad-id-with-spaces"
    assert resp.headers["X-Request-ID"] == "bad-id-with-spaces"


def test_determinism_same_request_same_candidates(client):
    payload = {"intent": mvp_intent(), "candidate_count": 4, "seed": 999}
    a = client.post("/generate", json=payload).json()
    b = client.post("/generate", json=payload).json()
    # request_id를 제외하면 후보 id 집합은 byte-identical (엔진 결정론)
    assert [c["id"] for c in a["candidates"]] == [c["id"] for c in b["candidates"]]


def test_semantic_invalid_intent_returns_422(client):
    intent = mvp_intent()
    intent["layers"][0]["params"]["color"] = "missing"
    resp = client.post("/generate", json={"intent": intent})
    assert resp.status_code == 422
    assert "missing" in str(resp.json()["detail"])


def test_error_response_echoes_request_id_header(client):
    # 의미 오류(422)여도 미들웨어는 X-Request-ID를 응답 헤더로 에코한다.
    intent = mvp_intent()
    intent["layers"][0]["params"]["color"] = "missing"
    resp = client.post("/generate", headers={"X-Request-ID": "err-1"}, json={"intent": intent})
    assert resp.status_code == 422
    assert resp.headers["X-Request-ID"] == "err-1"


def test_concurrent_requests_keep_distinct_request_ids(monkeypatch):
    # contextvar + 미들웨어 경로를 실제 동시성에서 검증: 각 응답은 자신의 주입 id를 에코.
    app = _configure_app(monkeypatch)

    async def run():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as ac:

            async def one(i: int):
                rid = f"req-{i}"
                r = await ac.post(
                    "/generate",
                    headers={"X-Request-ID": rid},
                    json={"intent": mvp_intent(), "candidate_count": 2},
                )
                return rid, r.json()["request_id"], r.headers["X-Request-ID"]

            return await asyncio.gather(*[one(i) for i in range(20)])

    for sent, body_rid, header_rid in asyncio.run(run()):
        assert body_rid == sent == header_rid


def test_schema_invalid_request_returns_422(client):
    # candidate_count가 스키마 범위(1..8) 밖 — 요청 스키마 실패(422), 의미 오류 아님.
    resp = client.post("/generate", json={"intent": mvp_intent(), "candidate_count": 99})
    assert resp.status_code == 422


def test_preview_render_parallelism_is_bounded(monkeypatch):
    app = _configure_app(monkeypatch)
    lock = threading.Lock()
    active = 0
    maximum = 0

    def slow_raster(_svg, **_kwargs):
        nonlocal active, maximum
        with lock:
            active += 1
            maximum = max(maximum, active)
        time.sleep(0.02)
        with lock:
            active -= 1
        return b"fake-png", "image/png"

    monkeypatch.setattr(routes, "rasterize_svg", slow_raster)
    response = TestClient(app).post(
        "/generate", json={"intent": mvp_intent(), "candidate_count": 8}
    )
    assert response.status_code == 200
    assert maximum <= app.state.settings.preview_render_concurrency


def test_prompt_only_without_gemini_returns_503(client):
    # prompt 경로는 구현됐지만 Gemini 미구성(DryRun)이면 503 — intent 직접 경로는 계속 동작.
    resp = client.post("/generate", json={"prompt": "navy paisley tie"})
    assert resp.status_code == 503


def test_partial_success_when_count_exceeds_available(client):
    # distinct 결정론 변이보다 많은 후보를 요청하면 partial.
    intent = mvp_intent()
    intent["layers"] = [intent["layers"][0]]  # 배경 단일 레이어
    resp = client.post("/generate", json={"intent": intent, "candidate_count": 8})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["candidates"]) < 8
    assert any("partial" in w for w in body["warnings"])


def test_intent_and_prompt_together_returns_200(client):
    # D6: intent+prompt 동시 — 원본은 경고, essesion은 prompt를 로그에만 남기고 200.
    resp = client.post("/generate", json={"intent": mvp_intent(), "prompt": "ignored for now"})
    assert resp.status_code == 200

"""/generate 라우트 계약 — 원본 seamless-tile tests/test_api_generate.py 이식.

essesion 조정: 경로 `/generate`, 응답은 서버측 후보 계약(id/design_index/layout_id/
source_fidelity/colorway_id/seed/svg/png_object_key), 프리뷰는 GCS object key.
응답 캐시(원본의 2 테스트)는 essesion 미구현이라 제외.

픽스처: create_app() + get_session 페이크 세션 오버라이드 + rasterize_svg monkeypatch +
app.state.object_store = FakeObjectStore(). lifespan은 돌지 않으므로 state를 직접 주입.
"""

import asyncio
import base64
import hashlib
import io
import random
from contextlib import asynccontextmanager

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from PIL import Image
from worker.api import routes
from worker.db import get_session
from worker.main import create_app
from worker.render.raster import RasterError
from worker.warnings import WARNING_MESSAGES, customer_warnings

from .conftest import FakeObjectStore
from .intent_helpers import mvp_intent, register_test_motifs

register_test_motifs()

_RUN_ID = "11111111-1111-4111-8111-111111111111"


class _EmptyScalars:
    def all(self):
        return []


class _EmptyRows:
    def all(self):
        return []


class _NestedTransaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None


class _FakeSession:
    """generate 라우트가 쓰는 최소 세션 — add/commit + 빈 DB 읽기(registry_version·catalog).

    DB에 모티프가 없으므로 get_motifs는 {}, fingerprint는 baseline을 반환 → 라우트는
    전역 registry 폴백(register_test_motifs)으로 렌더한다.
    """

    def add(self, obj) -> None:
        pass

    async def commit(self) -> None:
        pass

    async def flush(self) -> None:
        pass

    async def rollback(self) -> None:
        pass

    async def scalars(self, *_args, **_kwargs):
        return _EmptyScalars()

    async def execute(self, *_args, **_kwargs):
        return _EmptyRows()

    def begin_nested(self):
        return _NestedTransaction()


def _configure_app(monkeypatch, *, raster_ok: bool = True):
    app = create_app()
    app.state.object_store = FakeObjectStore()  # lifespan 미실행 — 직접 주입

    def _raster(svg, **kwargs):
        if not raster_ok:
            raise RasterError("raster unavailable")
        return (b"fake-png", "image/png")

    monkeypatch.setattr(routes, "rasterize_svg", _raster)

    async def _session():
        yield _FakeSession()

    app.dependency_overrides[get_session] = _session

    @asynccontextmanager
    async def _sessionmaker():
        yield _FakeSession()

    app.state.sessionmaker = _sessionmaker
    return app


@pytest.fixture
def client(monkeypatch):
    return TestClient(_configure_app(monkeypatch))


_DESIGN_KEYS = {
    "id",
    "layout_id",
    "source_fidelity",
    "colorway_id",
    "seed",
    "svg",
    "png_object_key",
    "panel_svg",
}


def test_generate_returns_product_shape(client):
    intent = mvp_intent()
    resp = client.post("/generate", json={"run_id": _RUN_ID, "intent": intent})
    assert resp.status_code == 200
    body = resp.json()
    assert body["request_id"]
    assert body["engine_version"] and body["registry_version"]
    assert body["intent"] == intent
    design = body["design"]
    assert set(design) == _DESIGN_KEYS
    digest = hashlib.sha256(b"fake-png").hexdigest()[:16]
    assert design["png_object_key"] == (
        f"previews/{body['request_id']}/{design['id']}/{digest}.png"
    )


def test_warnings_are_customer_facing_and_deduped_by_code(client):
    intent = mvp_intent()
    intent["palette"]["slots"][2]["hex"] = "#ffd700"
    intent["colorways"][0]["mapping"]["gold"] = "#ffd700"
    resp = client.post("/generate", json={"run_id": _RUN_ID, "intent": intent})
    assert resp.status_code == 200
    warnings = resp.json()["warnings"]
    codes = [item["code"] for item in warnings]
    assert codes.count("color_out_of_gamut") == 1
    assert len(codes) == len(set(codes))
    # 엔진 영문 문자열이 아니라 한글 한 줄만 노출된다.
    assert all(item["message"] and "gamut" not in item["message"] for item in warnings)


def test_customer_warnings_maps_every_code_once_in_diagnostic_order():
    texts = [
        "color #FFD700 is outside CMYK gamut",
        "motif bee dropped (unavailable)",
        # 화면에 보이는 자동 맞춤·인프라 실패는 고객에게 말하지 않는다(로그·admin에만).
        "preview upload skipped",
        "spacing snapped to 8.0mm",
        "widths reduced to keep the background visible",
        "motif size 9.0mm (lattice cell 8.0mm)",
        "another color is outside CMYK gamut",  # 중복 코드는 첫 건만
        "engine did something unmapped",  # 문구 없는 진단은 내려보내지 않는다
    ]

    warnings = customer_warnings(texts)

    assert [item["code"] for item in warnings] == [
        "color_out_of_gamut",
        "motif_dropped",
    ]
    assert [item["message"] for item in warnings] == [
        WARNING_MESSAGES[item["code"]] for item in warnings
    ]


def test_lattice_overlap_clamp_is_reported_as_a_warning(client):
    intent = mvp_intent()
    intent["layers"] = intent["layers"][:1] + [
        {
            "id": "motif_0",
            "type": "motif",
            "z_order": 1,
            "params": {"motif_id": "circle", "size_mm": 14.4},
            "placement": {
                "type": "lattice",
                "lattice": {"cell_w_mm": 12.0, "cell_h_mm": 12.0},
            },
        }
    ]
    resp = client.post("/generate", json={"run_id": _RUN_ID, "intent": intent})
    assert resp.status_code == 200
    body = resp.json()
    assert body["intent"]["layers"][1]["params"]["size_mm"] == 13.8
    # 클램프는 캔버스에서 보이는 조정이라 고객 경고로는 내려가지 않는다.
    assert body["warnings"] == []


def test_raster_failure_yields_null_png_key_with_warning(monkeypatch):
    client = TestClient(_configure_app(monkeypatch, raster_ok=False))
    resp = client.post("/generate", json={"run_id": _RUN_ID, "intent": mvp_intent()})
    assert resp.status_code == 200
    body = resp.json()
    assert body["design"]["png_object_key"] is None
    # 고객이 손쓸 수 없는 실패라 경고로 내려가지 않는다 — 진단은 로그·admin에 남는다.
    assert body["warnings"] == []


def test_preview_upload_failure_yields_null_key_without_failing_generate(monkeypatch):
    class FailingObjectStore:
        async def upload_bytes(self, *_args, **_kwargs):
            raise RuntimeError("storage unavailable")

    app = _configure_app(monkeypatch)
    app.state.object_store = FailingObjectStore()

    resp = TestClient(app).post("/generate", json={"run_id": _RUN_ID, "intent": mvp_intent()})

    assert resp.status_code == 200
    body = resp.json()
    assert body["design"]["png_object_key"] is None
    assert body["warnings"] == []


def test_request_id_propagates_to_body_and_header(client):
    resp = client.post("/generate", json={"run_id": _RUN_ID, "intent": mvp_intent()})
    assert resp.json()["request_id"] == resp.headers["X-Request-ID"]


def test_request_id_echoed_from_header(client):
    resp = client.post(
        "/generate",
        headers={"X-Request-ID": "trace-xyz"},
        json={"run_id": _RUN_ID, "intent": mvp_intent()},
    )
    assert resp.json()["request_id"] == "trace-xyz"
    assert resp.headers["X-Request-ID"] == "trace-xyz"


def test_request_id_header_is_sanitized(client):
    # B3: 인바운드 X-Request-ID는 정제된다 — 무정제 값은 GCS object key에 경로 주입 가능.
    resp = client.post(
        "/generate",
        headers={"X-Request-ID": "bad id.with spaces"},
        json={"run_id": _RUN_ID, "intent": mvp_intent()},
    )
    assert resp.json()["request_id"] == "bad-id-with-spaces"
    assert resp.headers["X-Request-ID"] == "bad-id-with-spaces"


def test_determinism_same_request_same_design(client):
    payload = {"run_id": _RUN_ID, "intent": mvp_intent(), "seed": 999}
    a = client.post("/generate", json=payload).json()
    b = client.post("/generate", json=payload).json()
    # request_id를 제외하면 디자인은 byte-identical (엔진 결정론)
    assert a["design"]["id"] == b["design"]["id"]
    assert a["design"]["svg"] == b["design"]["svg"]


def test_semantic_invalid_intent_returns_422(client):
    intent = mvp_intent()
    intent["layers"][0]["params"]["color"] = "missing"
    resp = client.post("/generate", json={"run_id": _RUN_ID, "intent": intent})
    assert resp.status_code == 422
    assert resp.json()["detail"] == {
        "code": "intent_invalid",
        "stage": "intent",
        "message": "the design input is invalid",
    }


def test_intent_path_compose_failure_returns_design_invalid(client):
    # 검증은 통과하지만 합성이 거부(unknown colorway)되면 intent_invalid가 아니라 design_invalid.
    resp = client.post(
        "/generate", json={"run_id": _RUN_ID, "intent": mvp_intent(), "colorway": "nope"}
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == {
        "code": "design_invalid",
        "stage": "design",
        "message": "the design could not be composed",
    }


def test_error_response_echoes_request_id_header(client):
    # 의미 오류(422)여도 미들웨어는 X-Request-ID를 응답 헤더로 에코한다.
    intent = mvp_intent()
    intent["layers"][0]["params"]["color"] = "missing"
    resp = client.post(
        "/generate",
        headers={"X-Request-ID": "err-1"},
        json={"run_id": _RUN_ID, "intent": intent},
    )
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
                    json={"run_id": _RUN_ID, "intent": mvp_intent()},
                )
                return rid, r.json()["request_id"], r.headers["X-Request-ID"]

            return await asyncio.gather(*[one(i) for i in range(20)])

    for sent, body_rid, header_rid in asyncio.run(run()):
        assert body_rid == sent == header_rid


def test_request_schema_rejects_unknown_fields(client):
    response = client.post(
        "/generate",
        json={
            "run_id": _RUN_ID,
            "intent": mvp_intent(),
            "pattern_contraints": {"density": "dense"},
        },
    )
    assert response.status_code == 422
    assert "extra_forbidden" in response.text


def test_user_svg_import_is_pure_normalization_response(monkeypatch):
    app = _configure_app(monkeypatch)
    response = TestClient(app).post(
        "/motifs/import",
        json={
            "svg": (
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
                '<circle cx="50" cy="50" r="30" fill="#123456"/></svg>'
            )
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["motif_id"].startswith("upload-")
    assert body["symbol"].startswith('<symbol id="motif-upload-')
    assert "color_slots" not in body
    assert body["bbox"] == [-0.5, -0.5, 0.5, 0.5]
    assert body["anchor"] == [0.0, 0.0]
    assert body["preview_svg"].startswith("<svg ")


def test_user_svg_import_maps_defensive_recursion_failure_to_422(monkeypatch):
    monkeypatch.setattr(
        routes,
        "normalize_motif_svg",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RecursionError("nested SVG")),
    )
    response = TestClient(_configure_app(monkeypatch)).post(
        "/motifs/import",
        json={"svg": '<svg viewBox="0 0 1 1"><path d="M0 0L1 1"/></svg>'},
    )
    assert response.status_code == 422
    assert "nested SVG" in response.text


@respx.mock
def test_photo_preview_fetches_the_private_image(monkeypatch):
    raw = io.BytesIO()
    image = Image.new("RGB", (64, 64), "white")
    for y in range(16, 48):
        for x in range(16, 48):
            image.putpixel((x, y), (220, 20, 40))
    image.save(raw, "PNG")
    image_bytes = raw.getvalue()
    image_url = "https://storage.googleapis.example/private/motif-source.png"
    respx.get(image_url).mock(return_value=httpx.Response(200, content=image_bytes))
    image_input = {
        "url": image_url,
        "content_type": "image/png",
        "size_bytes": len(image_bytes),
    }
    client = TestClient(_configure_app(monkeypatch))

    preview = client.post(
        "/motifs/photo-preview",
        json={"image": image_input},
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["background_confidence"] >= 0.55
    assert "#dd1122" in body["svg"].lower() and "#ffffff" not in body["svg"].lower()
    with Image.open(io.BytesIO(base64.b64decode(body["processed_preview_base64"]))) as processed:
        assert processed.format == "PNG"

    removed_options = client.post(
        "/motifs/photo-preview",
        json={
            "image": image_input,
            "color_count": 2,
            "simplification": "low",
        },
    )
    assert removed_options.status_code == 422


@respx.mock
def test_photo_preview_rejection_carries_a_code_for_the_api(monkeypatch):
    """사용자가 다른 사진으로 고칠 수 있는 거절은 코드를 싣는다 — api가 고객 문구를 고른다.

    사진처럼 배경이 고르지 않으면 평면 배경 분리가 불가능하다. 영문 message만 돌려주면
    api가 사유를 잃고 "요청을 거부했습니다" 하나로 뭉개진다.
    """
    raw = io.BytesIO()
    noise = random.Random(11)  # 전역 random을 건드리면 다른 테스트의 재현성을 흔든다
    image = Image.new("RGB", (96, 96))
    image.putdata(
        [
            (noise.randint(0, 255), noise.randint(0, 255), noise.randint(0, 255))
            for _ in range(96 * 96)
        ]
    )
    image.save(raw, "PNG")
    image_bytes = raw.getvalue()
    image_url = "https://storage.googleapis.example/private/noisy.png"
    respx.get(image_url).mock(return_value=httpx.Response(200, content=image_bytes))
    client = TestClient(_configure_app(monkeypatch))

    response = client.post(
        "/motifs/photo-preview",
        json={
            "image": {
                "url": image_url,
                "content_type": "image/png",
                "size_bytes": len(image_bytes),
            },
        },
    )

    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "photo_background_unclear"

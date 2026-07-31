"""/generate 라우트 계약 — 원본 seamless-tile tests/test_api_generate.py 이식.

essesion 조정: 경로 `/generate`, 응답은 서버측 후보 계약(id/design_index/layout_id/
source_fidelity/colorway_id/seed/svg/png_object_key), 프리뷰는 GCS object key.
응답 캐시(원본의 2 테스트)는 essesion 미구현이라 제외.

픽스처: create_app() + get_session 페이크 세션 오버라이드 + rasterize_svg monkeypatch +
app.state.object_store = DryRunObjectStore(). lifespan은 돌지 않으므로 state를 직접 주입.
"""

import asyncio
import base64
import hashlib
import io
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from PIL import Image
from worker.adapters import Adapters
from worker.adapters.gemini import AuthoredDesign
from worker.api import routes
from worker.authoring.retrieval import RetrievalOutcome
from worker.db import get_session
from worker.engine.patch import DesignPatchV1
from worker.integrations import DryRunObjectStore
from worker.main import create_app
from worker.motifs.registry import get_motif
from worker.render.raster import RasterError
from worker.warnings import WARNING_MESSAGES, customer_warnings

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
    app.state.object_store = DryRunObjectStore()  # lifespan 미실행 — 직접 주입
    app.state.adapters = Adapters()  # 어댑터 미구성(DryRun)

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
}


def _motif_layer(intent: dict) -> dict:
    return next(layer for layer in intent["layers"] if layer["type"] == "motif")


def test_unlabeled_legacy_multicolor_motif_uses_positional_modulo():
    intent = mvp_intent()
    motif_layer = _motif_layer(intent)
    motif_layer["params"]["motif_id"] = "multi"

    routes._bind_resolved_motif_colors(
        [intent],
        {
            "multi": SimpleNamespace(
                color_slots=("s0", "s1", "s2"),
                slot_colors=None,
                slot_labels=None,
            )
        },
    )

    assert "color" not in motif_layer["params"]
    assert motif_layer["params"]["colors"] == {
        "s0": "accent",
        "s1": "gold",
        "s2": "accent",
    }


def test_multicolor_motif_preserves_original_colors_when_recolor_is_omitted():
    intent = mvp_intent()
    motif_layer = _motif_layer(intent)
    motif_layer["params"]["motif_id"] = "multi"

    routes._bind_resolved_motif_colors(
        [intent],
        {
            "multi": SimpleNamespace(
                color_slots=("s0", "s1", "s2"),
                slot_colors=("#112233", "#445566", "#778899"),
                slot_labels=("detail", "primary", "outline"),
            )
        },
    )

    assert motif_layer["params"]["colors"] == {
        "s0": "#112233",
        "s1": "#445566",
        "s2": "#778899",
    }


def test_explicit_recolor_assigns_palette_by_semantic_label_rank():
    intent = mvp_intent()
    motif_layer = _motif_layer(intent)
    motif_layer["id"] = "ranked"
    motif_layer["params"]["motif_id"] = "multi"

    routes._bind_resolved_motif_colors(
        [intent],
        {
            "multi": SimpleNamespace(
                color_slots=("s0", "s1", "s2"),
                slot_colors=("#112233", "#445566", "#778899"),
                slot_labels=("detail", "primary", "outline"),
            )
        },
        [{"ranked": ["gold", "accent", "gold"]}],
    )

    # Ranked slot order is s1(primary), s2(outline), s0(detail).
    assert motif_layer["params"]["colors"] == {
        "s0": "gold",
        "s1": "gold",
        "s2": "accent",
    }


def test_part_aware_recolor_assigns_palette_in_exposed_slot_order():
    intent = mvp_intent()
    motif_layer = _motif_layer(intent)
    motif_layer["id"] = "part-aware"
    motif_layer["params"]["motif_id"] = "multi"

    routes._bind_resolved_motif_colors(
        [intent],
        {
            "multi": SimpleNamespace(
                color_slots=("s0", "s1", "s2"),
                slot_colors=("#112233", "#445566", "#778899"),
                slot_labels=("detail", "primary", "outline"),
                slot_parts=("몸통", "자전거", "부리·안장"),
            )
        },
        [{"part-aware": ["gold", "accent", "gold"]}],
    )

    assert motif_layer["params"]["colors"] == {
        "s0": "gold",
        "s1": "accent",
        "s2": "gold",
    }


def test_mismatched_recolor_count_adapts_by_cycling_planned_colors():
    # 컴파일 단계가 카탈로그 모티프의 recolor 길이를 이미 강제하므로, 바인딩에 도달한
    # 불일치는 슬롯 수를 알 수 없던 생성/사진 모티프뿐 — 요청 전체 실패 대신 순환 배정.
    intent = mvp_intent()
    motif_layer = _motif_layer(intent)
    motif_layer["id"] = "part-aware"
    motif_layer["params"]["motif_id"] = "multi"

    adapted = routes._bind_resolved_motif_colors(
        [intent],
        {
            "multi": SimpleNamespace(
                color_slots=("s0", "s1", "s2"),
                slot_colors=("#112233", "#445566", "#778899"),
                slot_labels=("detail", "primary", "outline"),
                slot_parts=("몸통", "자전거", "부리·안장"),
            )
        },
        [{"part-aware": ["gold", "accent"]}],
    )

    assert adapted == ["part-aware"]
    assert motif_layer["params"]["colors"] == {"s0": "gold", "s1": "accent", "s2": "gold"}


def test_single_color_recolor_broadcasts_across_unknown_slot_count():
    # 생성 모티프는 플랜 시점 slot_count 간주값이 1이라 지명색 보정이 1개짜리
    # color_indices를 주입한다. 해석된 슬롯 수와 달라도 단색이면 전체에 칠한다.
    intent = mvp_intent()
    motif_layer = _motif_layer(intent)
    motif_layer["id"] = "generated"
    motif_layer["params"]["motif_id"] = "multi"

    routes._bind_resolved_motif_colors(
        [intent],
        {
            "multi": SimpleNamespace(
                color_slots=("s0", "s1", "s2"),
                slot_colors=("#112233", "#445566", "#778899"),
                slot_labels=("detail", "primary", "outline"),
                slot_parts=("몸통", "자전거", "부리·안장"),
            )
        },
        [{"generated": ["gold"]}],
    )

    assert motif_layer["params"]["colors"] == {"s0": "gold", "s1": "gold", "s2": "gold"}


def test_fixed_palette_recolors_even_when_color_indices_were_omitted():
    intent = mvp_intent()
    motif_layer = _motif_layer(intent)
    motif_layer["params"]["motif_id"] = "multi"

    routes._bind_resolved_motif_colors(
        [intent],
        {
            "multi": SimpleNamespace(
                color_slots=("s0", "s1"),
                slot_colors=("#112233", "#445566"),
                slot_labels=("secondary", "primary"),
                slot_parts=("몸통", "윤곽"),
            )
        },
        palette_mode="fixed",
    )

    assert motif_layer["params"]["colors"] == {"s0": "accent", "s1": "gold"}


def test_single_slot_avoids_ground_equivalent_hex_and_degenerate_palette_is_stable():
    intent = mvp_intent()
    motif_layer = _motif_layer(intent)
    motif_layer["id"] = "single"
    motif_layer["params"]["motif_id"] = "one"
    intent["palette"]["slots"][1]["hex"] = intent["palette"]["slots"][0]["hex"]

    routes._bind_resolved_motif_colors(
        [intent],
        {"one": SimpleNamespace(color_slots=("s0",), slot_colors=None, slot_labels=None)},
        [{"single": ["accent"]}],
    )
    assert motif_layer["params"]["color"] == "gold"

    intent["palette"]["slots"][2]["hex"] = intent["palette"]["slots"][0]["hex"]
    routes._bind_resolved_motif_colors(
        [intent],
        {"one": SimpleNamespace(color_slots=("s0",), slot_colors=None, slot_labels=None)},
        [{"single": ["accent"]}],
    )
    assert motif_layer["params"]["color"] == "accent"


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
        "preview_unavailable",
        "spacing_snapped",
        "stripe_coverage_reduced",
        "motif_size_clamped",
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
            "params": {"motif_id": "circle", "size_mm": 14.4, "color": "accent"},
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
    assert [w for w in body["warnings"] if w["code"] == "motif_size_clamped"]


def test_raster_failure_yields_null_png_key_with_warning(monkeypatch):
    client = TestClient(_configure_app(monkeypatch, raster_ok=False))
    resp = client.post("/generate", json={"run_id": _RUN_ID, "intent": mvp_intent()})
    assert resp.status_code == 200
    body = resp.json()
    assert body["design"]["png_object_key"] is None
    assert any(w["code"] == "preview_unavailable" for w in body["warnings"])


def test_preview_upload_failure_yields_null_key_without_failing_generate(monkeypatch):
    class FailingObjectStore:
        capability_mode = "real"

        async def upload_bytes(self, *_args, **_kwargs):
            raise RuntimeError("storage unavailable")

    app = _configure_app(monkeypatch)
    app.state.object_store = FailingObjectStore()

    resp = TestClient(app).post("/generate", json={"run_id": _RUN_ID, "intent": mvp_intent()})

    assert resp.status_code == 200
    body = resp.json()
    assert body["design"]["png_object_key"] is None
    assert [w["code"] for w in body["warnings"]] == ["preview_unavailable"]


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


def test_prompt_path_compose_failure_returns_design_invalid(monkeypatch):
    # Gemini가 _validate를 통과하는 intent를 반환해도 compose_design이 거부하면 design_invalid.
    async def fake_candidates(*_args, **_kwargs):
        return []

    class GroundedGemini:
        async def author_design(self, _prompt, **_kwargs):
            return AuthoredDesign(intent=mvp_intent())

    def broken_compose(*_args, **_kwargs):
        raise ValueError("composition rejected")

    monkeypatch.setattr(routes, "prompt_catalog_candidates", fake_candidates)
    app = _configure_app(monkeypatch)
    app.state.adapters = Adapters(gemini=GroundedGemini())
    monkeypatch.setattr(routes, "compose_design", broken_compose)

    resp = TestClient(app).post("/generate", json={"run_id": _RUN_ID, "prompt": "chess pattern"})
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


def test_prompt_only_without_gemini_returns_503(client):
    # prompt 경로는 구현됐지만 Gemini 미구성(DryRun)이면 503 — intent 직접 경로는 계속 동작.
    resp = client.post("/generate", json={"run_id": _RUN_ID, "prompt": "navy paisley tie"})
    assert resp.status_code == 503


def test_prompt_uses_raw_text_catalog_candidates_for_gemini_grounding(monkeypatch):
    captured = {}
    catalog = [
        {
            "catalog_ref": "catalog_1",
            "motif_id": "seed-chess-king",
            "subject": "chess",
            "description": "chess king outline",
            "style": "outline",
            "similarity": 1.0,
            "match_type": "exact_token",
        }
    ]

    async def fake_candidates(_session, prompt, *, embedding_client, tau, top_k):
        captured.update(
            prompt=prompt,
            embedding_client=embedding_client,
            tau=tau,
            top_k=top_k,
        )
        return catalog

    class GroundedGemini:
        async def author_design(self, _prompt, *, catalog_candidates, **_kwargs):
            assert catalog_candidates == catalog
            return AuthoredDesign(intent=mvp_intent())

    monkeypatch.setattr(routes, "prompt_catalog_candidates", fake_candidates)
    app = _configure_app(monkeypatch)
    app.state.adapters = Adapters(gemini=GroundedGemini())

    response = TestClient(app).post(
        "/generate",
        json={"run_id": _RUN_ID, "prompt": "chess 패턴 디자인해주세요"},
    )

    assert response.status_code == 200, response.text
    assert captured["prompt"] == "chess 패턴 디자인해주세요"
    assert captured["tau"] == app.state.settings.motif_similarity_tau
    assert captured["top_k"] == 5


def test_auto_references_fill_motif_capacity_without_catalog_lookup(monkeypatch):
    async def unexpected_candidates(*_args, **_kwargs):
        raise AssertionError("full reference capacity must skip catalog retrieval")

    async def fake_retrieve(_session, _prompt, **kwargs):
        assert kwargs["available_motif_count"] == 2
        return RetrievalOutcome(status="empty", reason="no_examples")

    class Gemini:
        async def author_design(self, _prompt, *, validate, catalog_candidates, **_kwargs):
            assert catalog_candidates == []
            intent = mvp_intent()
            assert validate(intent) is None
            return AuthoredDesign(intent=intent)

    async def fake_reference_images(_body, _settings):
        return []

    monkeypatch.setattr(routes, "prompt_catalog_candidates", unexpected_candidates)
    monkeypatch.setattr(routes, "retrieve_examples", fake_retrieve)
    monkeypatch.setattr(routes, "_load_reference_images", fake_reference_images)
    app = _configure_app(monkeypatch)
    app.state.adapters = Adapters(gemini=Gemini())

    response = TestClient(app).post(
        "/generate",
        json={
            "run_id": _RUN_ID,
            "prompt": "두 참고 이미지로 패턴 만들기",
            "reference_images": [
                {
                    "image_id": "c21585b4-bac6-4071-8903-6aa5dd3c2c79",
                    "url": "https://storage.googleapis.example/private/reference-1.png",
                    "content_type": "image/png",
                    "size_bytes": 100,
                    "purpose": "auto",
                },
                {
                    "image_id": "d32696c5-cbd7-4182-9014-7bb6ee4d3d80",
                    "url": "https://storage.googleapis.example/private/reference-2.png",
                    "content_type": "image/png",
                    "size_bytes": 100,
                    "purpose": "auto",
                },
            ],
        },
    )

    assert response.status_code == 200, response.text


def test_prompt_retrieval_error_uses_isolated_session_and_falls_back(monkeypatch):
    calls: list[str] = []
    retrieval_session = _FakeSession()

    async def fake_retrieve(session, prompt, **kwargs):
        assert session is retrieval_session
        calls.append("retrieve")
        assert prompt == "대각 스트라이프"
        assert kwargs["available_motif_count"] == 0
        return RetrievalOutcome(status="retrieval_error", reason="ProgrammingError")

    class Gemini:
        async def author_design(self, _prompt, *, validate, examples, diagnostics, **_kwargs):
            calls.append("author")
            assert examples == []
            assert diagnostics["example_retrieval_status"] == "retrieval_error"
            assert diagnostics["example_retrieval_reason"] == "ProgrammingError"
            intent = mvp_intent()
            assert validate(intent) is None
            diagnostics.update(
                plan_contract_version=3,
                compiler_revision="design-plan-v3.1",
                prompt_revision="design-plan-v3-rag-generated-motif-colors",
            )
            return AuthoredDesign(
                intent=intent,
                structural_fingerprint="layout-v3",
            )

    monkeypatch.setattr(routes, "retrieve_examples", fake_retrieve)
    app = _configure_app(monkeypatch)

    app.state.adapters = Adapters(gemini=Gemini())

    @asynccontextmanager
    async def _retrieval_sessionmaker():
        yield retrieval_session

    app.state.sessionmaker = _retrieval_sessionmaker

    response = TestClient(app).post(
        "/generate", json={"run_id": _RUN_ID, "prompt": "대각 스트라이프"}
    )

    assert response.status_code == 200, response.text
    assert calls == ["retrieve", "author"]


class _PatchGemini:
    """author_patch만 구현 — 구성 수정은 모티프 해석·예시 검색을 전혀 타지 않는다."""

    def __init__(self, patch: dict) -> None:
        self._patch = patch
        self.snapshots: list[dict] = []
        self.histories: list[list[dict]] = []

    async def author_patch(
        self, prompt, *, snapshot, conversation_history=None, palette_constraint=None, diagnostics
    ):
        self.snapshots.append(snapshot)
        self.histories.append(list(conversation_history or []))
        diagnostics["authoring_mode"] = "patch"
        return DesignPatchV1.model_validate(self._patch)

    async def author_design(self, *_args, **_kwargs):  # pragma: no cover - 호출되면 계약 위반
        raise AssertionError("composition edits must not re-author a plan")


def _patch_request(prompt: str, intent: dict) -> dict:
    return {
        "run_id": _RUN_ID,
        "prompt": prompt,
        "conversation_context": {
            "current_intent": intent,
            "history": [
                {
                    "user_prompt": "네이비 스트라이프로 만들어줘",
                    "assistant_summary": "3색 · 스트라이프",
                    "attachments": [],
                }
            ],
        },
    }


def test_composition_patch_edits_only_the_requested_axis(monkeypatch):
    gemini = _PatchGemini({"background": {"color": "#F5F0E6"}, "note": "바탕을 밝게 했어요."})
    app = _configure_app(monkeypatch)
    app.state.adapters = Adapters(gemini=gemini)
    intent = mvp_intent()

    response = TestClient(app).post("/generate", json=_patch_request("바탕을 밝게", intent))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["note"] == "바탕을 밝게 했어요."
    assert body["plan"] is None  # patch 경로는 plan을 다시 저작하지 않는다
    slots = {slot["id"]: slot["hex"] for slot in body["intent"]["palette"]["slots"]}
    assert slots["ground"] == "#F5F0E6"
    # 모티프는 타입상 바뀔 수 없다.
    assert [
        layer["params"]["motif_id"]
        for layer in body["intent"]["layers"]
        if layer["type"] == "motif"
    ] == ["circle", "bee"]
    # 모델에게는 모티프 정체성이 아니라 구성 스냅샷만 간다.
    assert "circle" not in json.dumps(gemini.snapshots[0])
    assert gemini.histories[0][0]["user_prompt"] == "네이비 스트라이프로 만들어줘"


def test_out_of_scope_patch_returns_scope_rejected_without_a_design(monkeypatch):
    gemini = _PatchGemini({"out_of_scope": True, "note": "무늬는 여기서 바꿀 수 없어요."})
    app = _configure_app(monkeypatch)
    app.state.adapters = Adapters(gemini=gemini)

    response = TestClient(app).post(
        "/generate", json=_patch_request("벌을 나비로 바꿔줘", mvp_intent())
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"status": "scope_rejected"}


def test_composition_patch_rejects_motif_inputs_in_the_contract(monkeypatch):
    app = _configure_app(monkeypatch)
    app.state.adapters = Adapters(gemini=_PatchGemini({"note": "x"}))
    payload = _patch_request("이 사진처럼", mvp_intent())
    payload["motif_ids"] = ["circle"]

    response = TestClient(app).post("/generate", json=payload)

    assert response.status_code == 422
    assert "cannot include reference images or motif ids" in response.text


@respx.mock
def test_reference_photo_is_safely_prepared_and_sent_to_gemini(monkeypatch):
    class CapturingGemini:
        def __init__(self):
            self.calls = []

        async def author_design(
            self,
            prompt,
            *,
            validate,
            reference_images,
            motif_ids,
            palette_constraint,
            pattern_constraints,
            **_kwargs,
        ):
            assert palette_constraint.mode == "auto"
            assert pattern_constraints.is_automatic()
            self.calls.append((prompt, reference_images, motif_ids))
            intent = mvp_intent()
            assert validate(intent) is None
            return AuthoredDesign(intent=intent)

    raw = io.BytesIO()
    Image.new("RGBA", (4, 3), (12, 34, 56, 128)).save(raw, format="PNG")
    image_bytes = raw.getvalue()
    image_id = "c21585b4-bac6-4071-8903-6aa5dd3c2c79"
    image_url = "https://storage.googleapis.example/private/reference.png"
    respx.get(image_url).mock(
        return_value=httpx.Response(
            200,
            content=image_bytes,
            headers={"Content-Type": "image/png"},
        )
    )
    gemini = CapturingGemini()
    app = _configure_app(monkeypatch)
    app.state.adapters = Adapters(gemini=gemini)

    response = TestClient(app).post(
        "/generate",
        json={
            "run_id": _RUN_ID,
            "prompt": "사진의 색과 분위기를 참고한 패턴",
            "reference_images": [
                {
                    "image_id": image_id,
                    "url": image_url,
                    "content_type": "image/png",
                    "size_bytes": len(image_bytes),
                    "purpose": "color_mood",
                }
            ],
        },
    )

    assert response.status_code == 200, response.text
    assert len(gemini.calls) == 1
    prompt, references, motif_ids = gemini.calls[0]
    assert prompt == "사진의 색과 분위기를 참고한 패턴"
    assert motif_ids == []
    assert len(references) == 1
    assert references[0].mime_type == "image/jpeg"
    assert references[0].purpose == "color_mood"
    assert references[0].data.startswith(b"\xff\xd8")


def test_reference_photo_rejects_untrusted_url_before_fetch(monkeypatch):
    app = _configure_app(monkeypatch)
    app.state.adapters = Adapters(gemini=object())
    response = TestClient(app).post(
        "/generate",
        json={
            "run_id": _RUN_ID,
            "prompt": "reference",
            "reference_images": [
                {
                    "image_id": "c21585b4-bac6-4071-8903-6aa5dd3c2c79",
                    "url": "https://attacker.invalid/private.png",
                    "content_type": "image/png",
                    "size_bytes": 100,
                }
            ],
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "reference_invalid"
    assert response.json()["detail"]["stage"] == "reference"


def test_generate_accepts_at_most_two_explicit_motifs(monkeypatch):
    catalog_reads = 0

    async def prompt_then_render_catalog(_session, _ids):
        nonlocal catalog_reads
        catalog_reads += 1
        if catalog_reads == 1:
            return {
                "circle": SimpleNamespace(color_slots=("s0",), slot_parts=None),
                "bee": SimpleNamespace(
                    color_slots=("s0", "s1"),
                    slot_parts=("몸통", "날개"),
                ),
            }
        return {"circle": get_motif("circle"), "bee": get_motif("bee")}

    class ExactMotifGemini:
        async def author_design(
            self,
            _prompt,
            *,
            validate,
            motif_ids,
            exact_motif_metadata,
            **_kwargs,
        ):
            assert motif_ids == ["circle", "bee"]
            assert exact_motif_metadata == [
                {"catalog_ref": "input_1", "slot_count": 1},
                {
                    "catalog_ref": "input_2",
                    "slot_count": 2,
                    "parts": ["몸통", "날개"],
                },
            ]
            intent = mvp_intent()
            assert validate(intent) is None
            return AuthoredDesign(intent=intent)

    monkeypatch.setattr(routes, "get_motifs", prompt_then_render_catalog)
    app = _configure_app(monkeypatch)
    app.state.adapters = Adapters(gemini=ExactMotifGemini())
    client = TestClient(app)

    accepted = client.post("/generate", json={"run_id": _RUN_ID, "motif_ids": ["circle", "bee"]})
    assert accepted.status_code == 200, accepted.text

    rejected = client.post(
        "/generate",
        json={
            "run_id": _RUN_ID,
            "motif_ids": [
                "upload-111111111111",
                "upload-222222222222",
                "upload-333333333333",
            ],
        },
    )
    assert rejected.status_code == 422


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
    assert body["color_slots"] == ["s0"]
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


def test_text_preview_import_preserves_normalized_identity(monkeypatch):
    client = TestClient(_configure_app(monkeypatch))
    preview = client.post(
        "/motifs/text-preview",
        json={
            "text": "가A1",
            "font_id": "nanum-gothic",
            "font_weight": 700,
            "letter_spacing": 0.1,
        },
    )
    assert preview.status_code == 200, preview.text
    imported = client.post("/motifs/import", json={"svg": preview.json()["svg"]})
    repeated = client.post("/motifs/import", json={"svg": preview.json()["svg"]})
    assert imported.status_code == 200, imported.text
    assert imported.json()["motif_id"] == repeated.json()["motif_id"]
    assert imported.json()["preview_svg"] == preview.json()["svg"]


def test_text_motif_preview_returns_importable_path_only_svg(monkeypatch):
    response = TestClient(_configure_app(monkeypatch)).post(
        "/motifs/text-preview",
        json={
            "text": "가A1",
            "font_id": "nanum-gothic",
            "font_weight": 700,
            "letter_spacing": 0.1,
        },
    )
    assert response.status_code == 200, response.text
    svg = response.json()["svg"]
    assert "<path" in svg
    assert "<text" not in svg


@respx.mock
def test_palette_and_photo_preview_reuse_private_image_fetch(monkeypatch):
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
        "image_id": "c21585b4-bac6-4071-8903-6aa5dd3c2c79",
        "url": image_url,
        "content_type": "image/png",
        "size_bytes": len(image_bytes),
    }
    client = TestClient(_configure_app(monkeypatch))

    palette = client.post("/palette/extract", json={"image": image_input, "color_count": 5})
    assert palette.status_code == 200, palette.text
    assert palette.json()["colors"] == ["#FFFFFF", "#DC1428"]

    preview = client.post(
        "/motifs/photo-preview",
        json={
            "image": image_input,
            "remove_background": True,
            "simplification": "medium",
            "color_count": 2,
        },
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["background_confidence"] >= 0.55
    assert 'color="#dc1428"' in body["svg"] and "#FFFFFF" not in body["svg"]
    with Image.open(io.BytesIO(base64.b64decode(body["processed_preview_base64"]))) as processed:
        assert processed.format == "PNG"


def test_ideas_endpoint_passes_exact_motif_names_without_starting_generation(monkeypatch):
    class FakeGemini:
        def __init__(self):
            self.calls = []

        async def suggest_ideas(self, prompt, **context):
            self.calls.append((prompt, context))
            return ["아이디어 하나", "아이디어 둘", "아이디어 셋"]

    gemini = FakeGemini()
    app = _configure_app(monkeypatch)
    app.state.adapters = Adapters(gemini=gemini)
    response = TestClient(app).post(
        "/ideas",
        json={
            "prompt": "차분한 패턴",
            "motif_ids": ["upload-a1b2c3d4e5f6"],
            "motifs": [{"motif_id": "upload-a1b2c3d4e5f6", "name": "동백"}],
            "palette": {"mode": "fixed", "colors": ["#123", "#abcdef"]},
            "pattern_constraints": {"density": "dense"},
            "count": 3,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"ideas": ["아이디어 하나", "아이디어 둘", "아이디어 셋"]}
    prompt, context = gemini.calls[0]
    assert prompt == "차분한 패턴"
    assert context["motifs"] == [{"motif_id": "upload-a1b2c3d4e5f6", "name": "동백"}]
    assert context["palette_constraint"].colors == ["#112233", "#ABCDEF"]
    assert context["pattern_constraints"].density == "dense"


def test_ideas_endpoint_rejects_motif_context_order_mismatch(monkeypatch):
    response = TestClient(_configure_app(monkeypatch)).post(
        "/ideas",
        json={
            "motif_ids": ["upload-a1b2c3d4e5f6"],
            "motifs": [{"motif_id": "upload-000000000000", "name": "다른 모티프"}],
        },
    )
    assert response.status_code == 422
    assert "same order" in response.text


def test_generate_rejects_mixing_intent_and_prompt(client):
    resp = client.post(
        "/generate",
        json={
            "run_id": _RUN_ID,
            "intent": mvp_intent(),
            "prompt": "줄무늬를 더 굵게 바꿔줘",
        },
    )

    assert resp.status_code == 422
    assert "intent variation cannot include prompt" in resp.text

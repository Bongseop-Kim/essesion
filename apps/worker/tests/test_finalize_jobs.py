"""동기 finalize 엔드포인트 — AI 실사화 경로의 성공·오류 계약 (finalize-ai-fabric.md).

잡 상태는 api가 소유한다(worker-pipeline.md §4) — 워커는 stateless라 DB 잡 행을
만들지도 읽지도 않는다. 여기서는 결정론 입력 실경로(골든 intent) + 어댑터 대역으로
편집 계약(입력 구성·오류 매핑·삼중 산출물)만 검증한다. 실제 gpt-image 품질은
캘리브레이션(실호출)이 담당.
"""

import io
import json
import logging
from pathlib import Path

import pytest
from db.models.seamless import Motif
from httpx import ASGITransport, AsyncClient
from PIL import Image
from worker.adapters.gpt_image import GPTImageError
from worker.api import routes
from worker.engine.validate import IntentInvalid
from worker.render.raster import RasterLimitError

GOLDEN = Path(__file__).parent / "golden"


def _fake_png(tag: str, size: str) -> bytes:
    """대역 응답 PNG — 같은 tag는 같은 바이트(content-addressed 키 검증용)."""
    color = (sum(tag.encode()) % 256, 64, 128)
    width, height = (int(v) for v in size.split("x"))
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buf, "PNG")
    return buf.getvalue()


class FakeGPTImage:
    """GPTImageHTTPClient.edit 프로토콜 대역 — 호출 기록 + 결정론 응답."""

    def __init__(
        self, fail_with: Exception | None = None, respond_size: str | None = None
    ) -> None:
        self.calls: list[dict] = []
        self.fail_with = fail_with
        # 요청과 다른 크기로 응답 — 치수 검증 테스트용
        self.respond_size = respond_size

    async def edit(
        self,
        prompt: str,
        *,
        images: list[bytes],
        mask: bytes | None = None,
        size: str,
        quality: str | None = None,
        operation: str = "edit",
    ) -> bytes:
        self.calls.append(
            {
                "prompt": prompt,
                "n_images": len(images),
                "has_mask": mask is not None,
                "size": size,
                "quality": quality,
                "operation": operation,
            }
        )
        if self.fail_with is not None:
            raise self.fail_with
        return _fake_png(operation, self.respond_size or size)


@pytest.fixture
def gpt_image(app):
    """앱 어댑터에 대역 주입 — conftest settings는 키가 비어 기본 None이다."""
    fake = FakeGPTImage()
    app.state.adapters.gpt_image = fake
    return fake


def _golden_motif_intent() -> tuple[dict, str, dict]:
    """골든 06 intent와 그 모티프 정의 — DB 카탈로그 경로 검증용."""
    intent = json.loads((GOLDEN / "json/06_motif_lattice_block.json").read_text())
    motif_id = "fixture-832977800421"
    spec = json.loads((GOLDEN / "motifs.json").read_text())[motif_id]
    return intent, motif_id, spec


async def _seed_golden_motif(db_session) -> dict:
    intent, motif_id, spec = _golden_motif_intent()
    db_session.add(
        Motif(
            id=motif_id,
            symbol=spec["symbol"],
            bbox=list(spec["bbox_mm"]),
            anchor=list(spec["anchor"]),
            source="seed",
        )
    )
    await db_session.commit()
    return intent


async def test_finalize_renders_edits_and_uploads_three_artifacts(
    client, gpt_image, db_session
):
    intent = await _seed_golden_motif(db_session)

    response = await client.post(
        "/finalize",
        json={"intent": intent, "dpi": 96, "production_method": "print"},
    )

    assert response.status_code == 200
    result = response.json()
    assert result["tie_object_key"].startswith("fabric/")
    assert result["fabric_object_key"].startswith("fabric/")
    assert result["tile_object_key"].startswith("tile/")
    # 레거시 별칭 — 컷오버 전 api(result_url)가 읽는다.
    assert result["object_key"] == result["fabric_object_key"]

    # 편집 2회: 넥타이(베이스+렌더+직조, 마스크) / 원단(타일3×3+직조, 마스크 없음)
    assert len(gpt_image.calls) == 2  # by_op가 중복 호출을 삼키지 않도록 먼저 핀
    by_op = {call["operation"]: call for call in gpt_image.calls}
    assert set(by_op) == {"finalize_tie", "finalize_fabric"}
    assert by_op["finalize_tie"]["n_images"] == 3
    assert by_op["finalize_tie"]["has_mask"] is True
    assert by_op["finalize_tie"]["size"] == "1024x1536"
    assert by_op["finalize_fabric"]["n_images"] == 2
    assert by_op["finalize_fabric"]["has_mask"] is False
    assert by_op["finalize_fabric"]["size"] == "1024x1024"

    # content-addressed 키 — 같은 입력(+결정론 대역)은 같은 키로 수렴한다(멱등 업로드).
    again = await client.post(
        "/finalize",
        json={"intent": intent, "dpi": 96, "production_method": "print"},
    )
    assert again.json() == result


async def test_finalize_without_adapter_is_503(client, db_session):
    # conftest settings는 openai_api_key가 비어 gpt_image=None — 하드 503, 폴백 금지.
    intent = await _seed_golden_motif(db_session)
    response = await client.post(
        "/finalize", json={"intent": intent, "dpi": 96, "production_method": "print"}
    )
    assert response.status_code == 503


async def test_finalize_unknown_motif_is_permanent_failure_before_edits(
    client, gpt_image, db_session
):
    intent, _motif_id, _spec = _golden_motif_intent()
    intent["layers"][1]["params"]["motif_id"] = "fixture-missing-000000000000"

    response = await client.post(
        "/finalize",
        json={"intent": intent, "dpi": 96, "production_method": "print"},
    )

    # 결정론적 실패 — 재시도해도 같은 입력은 같은 실패라 4xx, 유료 편집은 호출 전이다
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == routes.FINALIZE_INVALID_INPUT_CODE
    assert gpt_image.calls == []


async def test_finalize_invalid_input_exposes_only_stable_public_error(
    client, gpt_image, monkeypatch, caplog
):
    secret = "internal-secret-from-fabric"

    def _fail(_params, _settings, _motifs=None):
        raise routes.FabricError(secret)

    monkeypatch.setattr(routes, "prepare_photoreal_inputs", _fail)
    caplog.set_level(logging.WARNING, logger=routes.__name__)

    response = await client.post("/finalize", json={"intent": {}})

    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": routes.FINALIZE_INVALID_INPUT_CODE,
        "message": routes.FINALIZE_INVALID_INPUT_MESSAGE,
    }
    assert secret not in response.text
    assert secret in caplog.text


@pytest.mark.parametrize(
    "error",
    [
        IntentInvalid(["invalid intent"]),
        RasterLimitError("raster area exceeds limit"),
    ],
)
async def test_finalize_deterministic_render_errors_are_permanent(
    client, gpt_image, monkeypatch, error
):
    def _fail(_params, _settings, _motifs=None):
        raise error

    monkeypatch.setattr(routes, "prepare_photoreal_inputs", _fail)

    response = await client.post("/finalize", json={"intent": {}})

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == routes.FINALIZE_INVALID_INPUT_CODE


@pytest.mark.parametrize(
    ("status_code", "expected_http"),
    [
        (400, 422),  # 업스트림 콘텐츠 거절 — 같은 입력은 같은 실패
        (429, 502),  # 레이트리밋 — 일시 실패, api가 환불
        (500, 502),  # 업스트림 5xx — 일시 실패
        (None, 502),  # 타임아웃 등 상태코드 없는 어댑터 실패
    ],
)
async def test_finalize_upstream_failures_map_by_permanence(
    app, client, db_session, status_code, expected_http
):
    intent = await _seed_golden_motif(db_session)
    app.state.adapters.gpt_image = FakeGPTImage(
        fail_with=GPTImageError(
            "upstream failure",
            provider="openai_image",
            operation="finalize_tie",
            status_code=status_code,
        )
    )

    response = await client.post(
        "/finalize", json={"intent": intent, "dpi": 96, "production_method": "print"}
    )

    assert response.status_code == expected_http
    if expected_http == 422:
        assert response.json()["detail"]["code"] == routes.FINALIZE_UPSTREAM_REJECTED_CODE


async def test_finalize_wrong_dimension_edit_output_is_502(app, client, db_session):
    # 요청 크기와 다른 응답은 invalid_response(status_code 없음) → 일시 실패 502, api가 환불.
    intent = await _seed_golden_motif(db_session)
    app.state.adapters.gpt_image = FakeGPTImage(respond_size="512x512")

    response = await client.post(
        "/finalize", json={"intent": intent, "dpi": 96, "production_method": "print"}
    )

    assert response.status_code == 502


async def test_finalize_rejects_dpi_above_limit(client, app):
    # /export와 같은 상한 — 극단 dpi는 어댑터 유무와 무관하게 렌더 전에 영구 실패(422).
    response = await client.post(
        "/finalize", json={"intent": {}, "dpi": app.state.settings.max_dpi + 1}
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == routes.FINALIZE_INVALID_INPUT_CODE


async def test_finalize_transient_failure_is_5xx(app, monkeypatch):
    secret = "internal-secret-from-storage"

    def _fail(_params, _settings, _motifs=None):
        raise RuntimeError(secret)

    app.state.adapters.gpt_image = FakeGPTImage()
    monkeypatch.setattr(routes, "prepare_photoreal_inputs", _fail)

    # 처리되지 않은 예외 → 500 — api가 UpstreamError로 변환해 과금을 환불한다.
    # 기본 client는 앱 예외를 다시 던지므로 HTTP 계약은 non-raising transport로 검증한다.
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/finalize", json={"intent": {}})

    assert response.status_code == 500
    assert secret not in response.text


async def test_finalize_rejects_unknown_fields(client):
    # StrictRequest — job.params에 없는 필드가 흘러들면 422로 계약 위반을 드러낸다.
    response = await client.post("/finalize", json={"intent": {}, "job_id": "x"})
    assert response.status_code == 422

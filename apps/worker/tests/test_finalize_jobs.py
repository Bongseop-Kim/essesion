"""동기 finalize 엔드포인트 — 렌더+업로드 성공, 영구 실패 422, 일시 실패 5xx.

잡 상태는 api가 소유한다(worker-pipeline.md §4) — 워커는 stateless라 DB 잡 행을
만들지도 읽지도 않는다. 여기서는 렌더 실경로(골든 intent)와 오류 계약만 검증한다.
"""

import json
import logging
from pathlib import Path

import pytest
from db.models.seamless import Motif
from httpx import ASGITransport, AsyncClient
from worker.api import routes
from worker.engine.validate import IntentInvalid
from worker.render.raster import RasterLimitError

GOLDEN = Path(__file__).parent / "golden"


def _golden_motif_intent() -> tuple[dict, str, dict]:
    """골든 06 intent와 그 모티프 정의 — DB 카탈로그 경로 검증용."""
    intent = json.loads((GOLDEN / "json/06_motif_lattice_block.json").read_text())
    motif_id = "fixture-832977800421"
    spec = json.loads((GOLDEN / "motifs.json").read_text())[motif_id]
    return intent, motif_id, spec


async def test_finalize_renders_db_backed_motifs_and_uploads(client, app, db_session):
    # generate 경로와 달리 finalize가 DB 모티프를 로드하지 않던 회귀 — 렌더 실경로로 검증.
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

    response = await client.post(
        "/finalize",
        json={"intent": intent, "dpi": 96, "production_method": "print"},
    )

    assert response.status_code == 200
    object_key = response.json()["object_key"]
    assert object_key.startswith("fabric/") and object_key.endswith(".png")

    # content-addressed 키 — 같은 입력은 같은 키로 수렴한다(멱등 업로드).
    again = await client.post(
        "/finalize",
        json={"intent": intent, "dpi": 96, "production_method": "print"},
    )
    assert again.json()["object_key"] == object_key


async def test_finalize_unknown_motif_is_permanent_failure(client, db_session):
    intent, _motif_id, _spec = _golden_motif_intent()
    intent["layers"][1]["params"]["motif_id"] = "fixture-missing-000000000000"

    response = await client.post(
        "/finalize",
        json={"intent": intent, "dpi": 96, "production_method": "print"},
    )

    # 결정론적 실패 — 재시도해도 같은 입력은 같은 실패라 4xx여야 한다
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == routes.FINALIZE_INVALID_INPUT_CODE


async def test_finalize_invalid_input_exposes_only_stable_public_error(client, monkeypatch, caplog):
    secret = "internal-secret-from-fabric"

    def _fail(_params, _settings, _motifs=None):
        raise routes.FabricError(secret)

    monkeypatch.setattr(routes, "render_fabric", _fail)
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
async def test_finalize_deterministic_render_errors_are_permanent(client, monkeypatch, error):
    def _fail(_params, _settings, _motifs=None):
        raise error

    monkeypatch.setattr(routes, "render_fabric", _fail)

    response = await client.post("/finalize", json={"intent": {}})

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == routes.FINALIZE_INVALID_INPUT_CODE


async def test_finalize_rejects_dpi_above_limit(client, app):
    # /export와 같은 상한 — 극단 dpi는 렌더 전에 영구 실패(422)로 자른다.
    response = await client.post(
        "/finalize", json={"intent": {}, "dpi": app.state.settings.max_dpi + 1}
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == routes.FINALIZE_INVALID_INPUT_CODE


async def test_finalize_transient_failure_is_5xx(app, monkeypatch):
    secret = "internal-secret-from-storage"

    def _fail(_params, _settings, _motifs=None):
        raise RuntimeError(secret)

    monkeypatch.setattr(routes, "render_fabric", _fail)

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

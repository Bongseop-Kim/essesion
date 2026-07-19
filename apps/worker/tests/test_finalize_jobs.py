import json
import logging
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from db.models.auth import User
from db.models.design import FINALIZE_DISPATCH_FAILED_MESSAGE, GenerationJob
from db.models.seamless import Motif
from worker.api import routes
from worker.engine.validate import IntentInvalid
from worker.render.raster import RasterLimitError

GOLDEN = Path(__file__).parent / "golden"


async def _job(
    db_session,
    *,
    status: str,
    attempts: int,
    updated_at=None,
    kind: str = "finalize",
    error_message: str | None = None,
) -> GenerationJob:
    user = User(email=None, name="finalize-test", role="customer")
    db_session.add(user)
    await db_session.flush()
    job = GenerationJob(
        user_id=user.id,
        kind=kind,
        status=status,
        attempts=attempts,
        params={"intent": {}},
        updated_at=updated_at,
        error_message=error_message,
    )
    db_session.add(job)
    await db_session.commit()
    await db_session.refresh(job)
    return job


async def test_fresh_processing_delivery_is_retryable_without_reclaim(client, db_session, settings):
    job = await _job(
        db_session,
        status="processing",
        attempts=1,
        updated_at=datetime.now(UTC),
    )

    response = await client.post("/tasks/finalize", json={"job_id": str(job.id)})

    assert response.status_code == 409
    await db_session.refresh(job)
    assert job.status == "processing"
    assert job.attempts == 1


async def test_stale_processing_lease_is_reclaimed(client, db_session, settings, monkeypatch):
    job = await _job(
        db_session,
        status="processing",
        attempts=1,
        updated_at=datetime.now(UTC) - timedelta(seconds=settings.finalize_lease_seconds + 1),
    )
    monkeypatch.setattr(routes, "render_fabric", lambda _params, _settings, _motifs=None: b"png")

    response = await client.post("/tasks/finalize", json={"job_id": str(job.id)})

    assert response.status_code == 200
    assert response.json()["status"] == "succeeded"
    await db_session.refresh(job)
    assert job.status == "succeeded"
    assert job.attempts == 2


async def test_late_attempt_cannot_overwrite_current_or_terminal_state(db_session):
    job = await _job(db_session, status="processing", attempts=2)

    late = await routes._finish_job(
        db_session, job.id, attempt=1, status="failed", error="late failure"
    )
    assert late is False
    await db_session.refresh(job)
    assert job.status == "processing"

    current = await routes._finish_job(
        db_session,
        job.id,
        attempt=2,
        status="succeeded",
        result={"object_key": "fabric/current.png"},
    )
    assert current is True

    late_after_success = await routes._finish_job(
        db_session, job.id, attempt=1, status="failed", error="late failure"
    )
    assert late_after_success is False
    await db_session.refresh(job)
    assert job.status == "succeeded"
    assert job.result == {"object_key": "fabric/current.png"}
    assert job.error_message is None


async def test_finalize_task_rejects_non_finalize_job(client, db_session):
    job = await _job(db_session, status="queued", attempts=0, kind="export")

    response = await client.post("/tasks/finalize", json={"job_id": str(job.id)})

    assert response.status_code == 200
    assert response.json() == {"status": "ignored", "reason": "job_kind_is_not_finalize"}
    await db_session.refresh(job)
    assert job.status == "queued"
    assert job.attempts == 0


def _golden_motif_intent() -> tuple[dict, str, dict]:
    """골든 06 intent와 그 모티프 정의 — DB 카탈로그 경로 검증용."""
    intent = json.loads((GOLDEN / "json/06_motif_lattice_block.json").read_text())
    motif_id = "recraft-832977800421"
    spec = json.loads((GOLDEN / "motifs.json").read_text())[motif_id]
    return intent, motif_id, spec


async def test_finalize_loads_db_backed_motifs(client, db_session):
    # generate 경로와 달리 finalize가 DB 모티프를 로드하지 않던 회귀 — 렌더 실경로로 검증.
    intent, motif_id, spec = _golden_motif_intent()
    db_session.add(
        Motif(
            id=motif_id,
            symbol=spec["symbol"],
            color_slots=list(spec["color_slots"]),
            bbox=list(spec["bbox_mm"]),
            anchor=list(spec["anchor"]),
        )
    )
    await db_session.commit()
    job = await _job(db_session, status="queued", attempts=0)
    job.params = {"intent": intent, "dpi": 96, "production_method": "print"}
    await db_session.commit()

    response = await client.post("/tasks/finalize", json={"job_id": str(job.id)})

    assert response.status_code == 200
    assert response.json()["status"] == "succeeded"
    await db_session.refresh(job)
    assert job.status == "succeeded"


async def test_finalize_unknown_motif_is_permanent_failure(client, db_session):
    intent, _motif_id, _spec = _golden_motif_intent()
    intent["layers"][1]["params"]["motif_id"] = "recraft-missing-000000000000"
    job = await _job(db_session, status="queued", attempts=0)
    job.params = {"intent": intent, "dpi": 96, "production_method": "print"}
    await db_session.commit()

    response = await client.post("/tasks/finalize", json={"job_id": str(job.id)})

    # 결정론적 실패 — 일시 실패(500 재시도)가 아니라 영구 실패로 ACK되어야 한다
    assert response.status_code == 200
    assert response.json()["status"] == "failed"
    assert response.json()["error"]["code"] == routes.FINALIZE_INVALID_INPUT_CODE
    await db_session.refresh(job)
    assert job.status == "failed"
    assert job.error_message != routes.FINALIZE_TEMPORARY_FAILURE_MARKER


async def test_canceled_job_is_acknowledged_without_running(client, db_session, monkeypatch):
    job = await _job(db_session, status="canceled", attempts=0)

    def unexpected_render(_params, _settings, _motifs=None):
        raise AssertionError("canceled job must not render")

    monkeypatch.setattr(routes, "render_fabric", unexpected_render)
    response = await client.post("/tasks/finalize", json={"job_id": str(job.id)})

    assert response.status_code == 200
    assert response.json() == {"status": "canceled"}
    await db_session.refresh(job)
    assert job.status == "canceled"
    assert job.attempts == 0


async def test_cancel_during_render_makes_late_result_inert(db_session):
    # 렌더 중(processing, attempt=1) API가 취소를 커밋한 상황 — 늦게 도착한
    # 성공 기록은 _finish_job의 processing 가드에 걸려 무효화되어야 한다.
    job = await _job(db_session, status="processing", attempts=1)
    job.status = "canceled"
    await db_session.commit()

    finished = await routes._finish_job(
        db_session,
        job.id,
        attempt=1,
        status="succeeded",
        result={"object_key": "fabric/late.png"},
    )

    assert finished is False
    await db_session.refresh(job)
    assert job.status == "canceled"
    assert job.result is None


async def test_late_task_cannot_run_dispatch_failed_refunded_job(client, db_session):
    job = await _job(
        db_session,
        status="failed",
        attempts=0,
        error_message=FINALIZE_DISPATCH_FAILED_MESSAGE,
    )

    response = await client.post("/tasks/finalize", json={"job_id": str(job.id)})

    assert response.status_code == 200
    assert response.json() == {"status": "canceled"}
    await db_session.refresh(job)
    assert job.status == "failed"
    assert job.attempts == 0


@pytest.mark.parametrize(
    "error_message",
    [
        f"{routes.FINALIZE_INVALID_INPUT_CODE}: {routes.FINALIZE_INVALID_INPUT_MESSAGE}",
        "legacy raw failure",
        None,
    ],
)
async def test_permanent_or_unknown_failed_job_is_terminal(
    client, db_session, monkeypatch, error_message
):
    job = await _job(
        db_session,
        status="failed",
        attempts=1,
        error_message=error_message,
    )

    def unexpected_render(_params, _settings, _motifs=None):
        raise AssertionError("terminal failed job must not render")

    monkeypatch.setattr(routes, "render_fabric", unexpected_render)
    response = await client.post("/tasks/finalize", json={"job_id": str(job.id)})

    assert response.status_code == 200
    assert response.json() == {"status": "failed"}
    await db_session.refresh(job)
    assert job.status == "failed"
    assert job.attempts == 1
    assert job.error_message == error_message


async def test_missing_finalize_job_is_acknowledged_without_retry(client):
    response = await client.post("/tasks/finalize", json={"job_id": str(uuid.uuid4())})

    assert response.status_code == 200
    assert response.json() == {"status": "ignored", "reason": "job_not_found"}


async def test_temporary_failed_job_is_retryable(client, db_session, monkeypatch):
    job = await _job(
        db_session,
        status="failed",
        attempts=1,
        error_message=routes.FINALIZE_TEMPORARY_FAILURE_MARKER,
    )
    monkeypatch.setattr(routes, "render_fabric", lambda _params, _settings, _motifs=None: b"png")

    response = await client.post("/tasks/finalize", json={"job_id": str(job.id)})

    assert response.status_code == 200
    assert response.json()["status"] == "succeeded"
    await db_session.refresh(job)
    assert job.status == "succeeded"
    assert job.attempts == 2
    assert job.error_message is None


async def test_finalize_invalid_input_exposes_only_stable_public_error(
    client, db_session, monkeypatch, caplog
):
    secret = "internal-secret-from-fabric"
    job = await _job(db_session, status="queued", attempts=0)

    def _fail(_params, _settings, _motifs=None):
        raise routes.FabricError(secret)

    monkeypatch.setattr(routes, "render_fabric", _fail)
    caplog.set_level(logging.WARNING, logger=routes.__name__)

    response = await client.post("/tasks/finalize", json={"job_id": str(job.id)})

    assert response.status_code == 200
    assert response.json() == {
        "status": "failed",
        "error": {
            "code": routes.FINALIZE_INVALID_INPUT_CODE,
            "message": routes.FINALIZE_INVALID_INPUT_MESSAGE,
        },
    }
    assert secret not in response.text
    await db_session.refresh(job)
    error_message = job.error_message
    assert error_message == (
        f"{routes.FINALIZE_INVALID_INPUT_CODE}: {routes.FINALIZE_INVALID_INPUT_MESSAGE}"
    )
    assert error_message is not None
    assert secret not in error_message
    assert secret in caplog.text


@pytest.mark.parametrize(
    "error",
    [
        IntentInvalid(["invalid intent"]),
        RasterLimitError("raster area exceeds limit"),
    ],
)
async def test_finalize_deterministic_render_errors_are_terminal(
    client, db_session, monkeypatch, error
):
    job = await _job(db_session, status="queued", attempts=0)

    def _fail(_params, _settings, _motifs=None):
        raise error

    monkeypatch.setattr(routes, "render_fabric", _fail)

    response = await client.post("/tasks/finalize", json={"job_id": str(job.id)})

    assert response.status_code == 200
    assert response.json()["error"]["code"] == routes.FINALIZE_INVALID_INPUT_CODE
    await db_session.refresh(job)
    assert job.status == "failed"
    assert job.attempts == 1
    assert job.error_message == (
        f"{routes.FINALIZE_INVALID_INPUT_CODE}: {routes.FINALIZE_INVALID_INPUT_MESSAGE}"
    )


async def test_finalize_transient_failure_exposes_only_stable_public_error(
    client, db_session, monkeypatch, caplog
):
    secret = "internal-secret-from-storage"
    job = await _job(db_session, status="queued", attempts=0)

    def _fail(_params, _settings, _motifs=None):
        raise RuntimeError(secret)

    monkeypatch.setattr(routes, "render_fabric", _fail)
    caplog.set_level(logging.ERROR, logger=routes.__name__)

    response = await client.post("/tasks/finalize", json={"job_id": str(job.id)})

    assert response.status_code == 500
    assert response.json() == {
        "detail": {
            "code": routes.FINALIZE_TEMPORARY_FAILURE_CODE,
            "message": routes.FINALIZE_TEMPORARY_FAILURE_MESSAGE,
        }
    }
    assert secret not in response.text
    await db_session.refresh(job)
    error_message = job.error_message
    assert error_message == (
        f"{routes.FINALIZE_TEMPORARY_FAILURE_CODE}: {routes.FINALIZE_TEMPORARY_FAILURE_MESSAGE}"
    )
    assert error_message is not None
    assert secret not in error_message
    assert secret in caplog.text

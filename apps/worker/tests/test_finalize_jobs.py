import logging
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from db.models.auth import User
from db.models.design import FINALIZE_DISPATCH_FAILED_MESSAGE, GenerationJob
from worker.api import routes
from worker.engine.validate import IntentInvalid
from worker.render.raster import RasterLimitError


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


@pytest.mark.anyio
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


@pytest.mark.anyio
async def test_stale_processing_lease_is_reclaimed(client, db_session, settings, monkeypatch):
    job = await _job(
        db_session,
        status="processing",
        attempts=1,
        updated_at=datetime.now(UTC) - timedelta(seconds=settings.finalize_lease_seconds + 1),
    )
    monkeypatch.setattr(routes, "render_fabric", lambda _params, _settings: b"png")

    response = await client.post("/tasks/finalize", json={"job_id": str(job.id)})

    assert response.status_code == 200
    assert response.json()["status"] == "succeeded"
    await db_session.refresh(job)
    assert job.status == "succeeded"
    assert job.attempts == 2


@pytest.mark.anyio
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


@pytest.mark.anyio
async def test_finalize_task_rejects_non_finalize_job(client, db_session):
    job = await _job(db_session, status="queued", attempts=0, kind="export")

    response = await client.post("/tasks/finalize", json={"job_id": str(job.id)})

    assert response.status_code == 200
    assert response.json() == {"status": "ignored", "reason": "job_kind_is_not_finalize"}
    await db_session.refresh(job)
    assert job.status == "queued"
    assert job.attempts == 0


@pytest.mark.anyio
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
@pytest.mark.anyio
async def test_permanent_or_unknown_failed_job_is_terminal(
    client, db_session, monkeypatch, error_message
):
    job = await _job(
        db_session,
        status="failed",
        attempts=1,
        error_message=error_message,
    )

    def unexpected_render(_params, _settings):
        raise AssertionError("terminal failed job must not render")

    monkeypatch.setattr(routes, "render_fabric", unexpected_render)
    response = await client.post("/tasks/finalize", json={"job_id": str(job.id)})

    assert response.status_code == 200
    assert response.json() == {"status": "failed"}
    await db_session.refresh(job)
    assert job.status == "failed"
    assert job.attempts == 1
    assert job.error_message == error_message


@pytest.mark.anyio
async def test_missing_finalize_job_is_acknowledged_without_retry(client):
    response = await client.post("/tasks/finalize", json={"job_id": str(uuid.uuid4())})

    assert response.status_code == 200
    assert response.json() == {"status": "ignored", "reason": "job_not_found"}


@pytest.mark.anyio
async def test_temporary_failed_job_is_retryable(client, db_session, monkeypatch):
    job = await _job(
        db_session,
        status="failed",
        attempts=1,
        error_message=routes.FINALIZE_TEMPORARY_FAILURE_MARKER,
    )
    monkeypatch.setattr(routes, "render_fabric", lambda _params, _settings: b"png")

    response = await client.post("/tasks/finalize", json={"job_id": str(job.id)})

    assert response.status_code == 200
    assert response.json()["status"] == "succeeded"
    await db_session.refresh(job)
    assert job.status == "succeeded"
    assert job.attempts == 2
    assert job.error_message is None


@pytest.mark.anyio
async def test_finalize_invalid_input_exposes_only_stable_public_error(
    client, db_session, monkeypatch, caplog
):
    secret = "internal-secret-from-fabric"
    job = await _job(db_session, status="queued", attempts=0)

    def _fail(_params, _settings):
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
@pytest.mark.anyio
async def test_finalize_deterministic_render_errors_are_terminal(
    client, db_session, monkeypatch, error
):
    job = await _job(db_session, status="queued", attempts=0)

    def _fail(_params, _settings):
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


@pytest.mark.anyio
async def test_finalize_transient_failure_exposes_only_stable_public_error(
    client, db_session, monkeypatch, caplog
):
    secret = "internal-secret-from-storage"
    job = await _job(db_session, status="queued", attempts=0)

    def _fail(_params, _settings):
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

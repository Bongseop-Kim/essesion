import base64
import json
import logging
import uuid
from typing import Protocol

from starlette.concurrency import run_in_threadpool

from api.config import Settings
from api.errors import ServiceUnavailableError

logger = logging.getLogger(__name__)
FINALIZE_DISPATCH_DEADLINE = "910s"


class TaskQueue(Protocol):
    capability_mode: str

    async def enqueue_finalize(self, job_id: uuid.UUID) -> str | None: ...


class DryRunTaskQueue:
    capability_mode = "dry_run"

    async def enqueue_finalize(self, job_id: uuid.UUID) -> str | None:
        logger.info("DRYRUN cloud tasks finalize enqueue: %s", job_id)
        return None


class UnavailableTaskQueue:
    capability_mode = "unavailable"

    async def enqueue_finalize(self, job_id: uuid.UUID) -> str | None:
        raise ServiceUnavailableError(
            "finalize 작업 큐를 사용할 수 없습니다.", code="finalize_tasks_unavailable"
        )


class CloudTasksRestQueue:
    capability_mode = "real"

    def __init__(self, settings: Settings):
        import google.auth
        from google.auth.transport.requests import AuthorizedSession

        credentials, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        self._session = AuthorizedSession(credentials)
        self._parent = (
            f"projects/{settings.gcp_project_id}/locations/{settings.gcp_region}"
            f"/queues/{settings.cloud_tasks_queue}"
        )
        self._url = f"https://cloudtasks.googleapis.com/v2/{self._parent}/tasks"
        self._target = f"{settings.worker_finalize_url.rstrip('/')}/tasks/finalize"
        self._service_account = settings.cloud_tasks_oidc_service_account
        # Cloud Tasks의 기본 audience는 path까지 포함한 target URL이다. Cloud Run은
        # 서비스 base audience를 검증하므로 둘을 명시적으로 분리한다.
        self._audience = (
            settings.worker_finalize_oidc_audience or settings.worker_finalize_url.rstrip("/")
        )

    async def enqueue_finalize(self, job_id: uuid.UUID) -> str | None:
        body = base64.b64encode(json.dumps({"job_id": str(job_id)}).encode()).decode()
        task_name = f"{self._parent}/tasks/finalize-{job_id}"
        payload = {
            "task": {
                "name": task_name,
                "dispatchDeadline": FINALIZE_DISPATCH_DEADLINE,
                "httpRequest": {
                    "httpMethod": "POST",
                    "url": self._target,
                    "headers": {"Content-Type": "application/json"},
                    "body": body,
                    "oidcToken": {
                        "serviceAccountEmail": self._service_account,
                        "audience": self._audience,
                    },
                },
            }
        }

        def _post() -> str:
            for attempt in range(2):
                try:
                    res = self._session.post(self._url, json=payload, timeout=10)
                    if res.status_code == 409:  # deterministic name의 기존 task = 전달 성공
                        return task_name
                    res.raise_for_status()
                    return res.json()["name"]
                except Exception:
                    if attempt == 1:
                        raise
                    # 첫 create가 성공하고 응답만 유실됐어도 같은 이름으로 재시도하면
                    # ALREADY_EXISTS가 되어 성공으로 수렴한다.
                    logger.warning("Cloud Tasks create 응답 불명 — 동일 task 재시도: %s", job_id)
            raise AssertionError("unreachable")

        return await run_in_threadpool(_post)


def build_task_queue(settings: Settings) -> TaskQueue:
    if (
        settings.gcp_project_id
        and settings.worker_finalize_url
        and settings.cloud_tasks_oidc_service_account
    ):
        return CloudTasksRestQueue(settings)
    if settings.env in ("local", "test"):
        logger.warning("Cloud Tasks 설정 없음 — DryRun task queue로 동작")
        return DryRunTaskQueue()
    logger.error("Cloud Tasks 설정 없음 — finalize task capability unavailable")
    return UnavailableTaskQueue()

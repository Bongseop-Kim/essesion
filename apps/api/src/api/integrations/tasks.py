import base64
import json
import logging
import uuid
from typing import Protocol

from starlette.concurrency import run_in_threadpool

from api.config import Settings

logger = logging.getLogger(__name__)


class TaskQueue(Protocol):
    async def enqueue_finalize(self, job_id: uuid.UUID) -> str | None: ...


class DryRunTaskQueue:
    async def enqueue_finalize(self, job_id: uuid.UUID) -> str | None:
        logger.info("DRYRUN cloud tasks finalize enqueue: %s", job_id)
        return None


class CloudTasksRestQueue:
    def __init__(self, settings: Settings):
        import google.auth
        from google.auth.transport.requests import AuthorizedSession

        credentials, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        self._session = AuthorizedSession(credentials)
        parent = (
            f"projects/{settings.gcp_project_id}/locations/{settings.gcp_region}"
            f"/queues/{settings.cloud_tasks_queue}"
        )
        self._url = f"https://cloudtasks.googleapis.com/v2/{parent}/tasks"
        self._target = f"{settings.worker_finalize_url.rstrip('/')}/tasks/finalize"
        self._service_account = settings.cloud_tasks_oidc_service_account

    async def enqueue_finalize(self, job_id: uuid.UUID) -> str | None:
        body = base64.b64encode(json.dumps({"job_id": str(job_id)}).encode()).decode()
        payload = {
            "task": {
                "httpRequest": {
                    "httpMethod": "POST",
                    "url": self._target,
                    "headers": {"Content-Type": "application/json"},
                    "body": body,
                    "oidcToken": {"serviceAccountEmail": self._service_account},
                }
            }
        }

        def _post() -> str:
            res = self._session.post(self._url, json=payload, timeout=10)
            res.raise_for_status()
            return res.json()["name"]

        return await run_in_threadpool(_post)


def build_task_queue(settings: Settings) -> TaskQueue:
    if (
        settings.gcp_project_id
        and settings.worker_finalize_url
        and settings.cloud_tasks_oidc_service_account
    ):
        return CloudTasksRestQueue(settings)
    logger.warning("Cloud Tasks 설정 없음 — DryRun task queue로 동작")
    return DryRunTaskQueue()

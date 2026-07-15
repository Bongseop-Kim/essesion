import base64
import json
import uuid

from api.integrations.tasks import FINALIZE_DISPATCH_DEADLINE, CloudTasksRestQueue


class _Response:
    status_code = 200

    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict[str, str]:
        return {"name": "projects/test/locations/test/queues/finalize/tasks/task-1"}


class _AuthorizedSession:
    instances: list["_AuthorizedSession"] = []

    def __init__(self, credentials) -> None:
        self.credentials = credentials
        self.calls: list[tuple[str, dict, int]] = []
        self.instances.append(self)

    def post(self, url: str, *, json: dict, timeout: int) -> _Response:
        self.calls.append((url, json, timeout))
        return _Response()


async def test_cloud_tasks_uses_service_audience_not_endpoint_url(settings, monkeypatch):
    monkeypatch.setattr("google.auth.default", lambda **kwargs: (object(), None))
    monkeypatch.setattr(
        "google.auth.transport.requests.AuthorizedSession",
        _AuthorizedSession,
    )
    configured = settings.model_copy(
        update={
            "gcp_project_id": "project-id",
            "gcp_region": "asia-northeast3",
            "cloud_tasks_queue": "finalize",
            "cloud_tasks_oidc_service_account": "tasks@project-id.iam.gserviceaccount.com",
            "worker_finalize_url": "https://worker-finalize.example.run.app/",
            "worker_finalize_oidc_audience": "https://worker-finalize.example.run.app",
        }
    )
    queue = CloudTasksRestQueue(configured)
    job_id = uuid.uuid4()

    task_name = await queue.enqueue_finalize(job_id)

    assert task_name == "projects/test/locations/test/queues/finalize/tasks/task-1"
    fake_session = _AuthorizedSession.instances[-1]
    assert len(fake_session.calls) == 1
    url, payload, timeout = fake_session.calls[0]
    assert url.endswith("/projects/project-id/locations/asia-northeast3/queues/finalize/tasks")
    assert timeout == 10
    request = payload["task"]["httpRequest"]
    expected_name = (
        f"projects/project-id/locations/asia-northeast3/queues/finalize/tasks/finalize-{job_id}"
    )
    assert payload["task"]["name"] == expected_name
    assert payload["task"]["dispatchDeadline"] == FINALIZE_DISPATCH_DEADLINE == "910s"
    assert request["url"] == "https://worker-finalize.example.run.app/tasks/finalize"
    assert request["oidcToken"] == {
        "serviceAccountEmail": "tasks@project-id.iam.gserviceaccount.com",
        "audience": "https://worker-finalize.example.run.app",
    }
    assert json.loads(base64.b64decode(request["body"])) == {"job_id": str(job_id)}


class _ConflictResponse(_Response):
    status_code = 409


class _AmbiguousAuthorizedSession(_AuthorizedSession):
    def post(self, url: str, *, json: dict, timeout: int) -> _Response:
        self.calls.append((url, json, timeout))
        if len(self.calls) == 1:
            # Cloud Tasks는 생성했지만 API가 응답을 받기 전에 연결이 끊긴 상황.
            raise TimeoutError("response lost after create")
        return _ConflictResponse()


async def test_cloud_tasks_ambiguous_create_retries_same_name_and_accepts_conflict(
    settings, monkeypatch
):
    monkeypatch.setattr("google.auth.default", lambda **kwargs: (object(), None))
    monkeypatch.setattr(
        "google.auth.transport.requests.AuthorizedSession",
        _AmbiguousAuthorizedSession,
    )
    configured = settings.model_copy(
        update={
            "gcp_project_id": "project-id",
            "gcp_region": "asia-northeast3",
            "cloud_tasks_queue": "finalize",
            "cloud_tasks_oidc_service_account": "tasks@project-id.iam.gserviceaccount.com",
            "worker_finalize_url": "https://worker-finalize.example.run.app",
        }
    )
    queue = CloudTasksRestQueue(configured)
    job_id = uuid.uuid4()
    expected_name = (
        f"projects/project-id/locations/asia-northeast3/queues/finalize/tasks/finalize-{job_id}"
    )

    task_name = await queue.enqueue_finalize(job_id)

    assert task_name == expected_name
    fake_session = _AmbiguousAuthorizedSession.instances[-1]
    assert len(fake_session.calls) == 2
    first_payload = fake_session.calls[0][1]
    second_payload = fake_session.calls[1][1]
    assert first_payload["task"]["name"] == expected_name
    assert second_payload["task"]["name"] == expected_name
    assert first_payload == second_payload

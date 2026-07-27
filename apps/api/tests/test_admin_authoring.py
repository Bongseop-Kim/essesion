"""관리자 저작 예시 승격과 active RAG 집합 계약."""

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock

from db.models.commerce import AdminOperationLog
from db.models.seamless import AuthoringExample, AuthoringPromotionCandidate
from sqlalchemy import select

from .factories import auth_headers, make_admin, make_user

DIM = 3072
MODEL = "test-embedding-3072"


def _vec(value: float = 1.0) -> list[float]:
    return [value] + [0.0] * (DIM - 1)


async def _candidate(
    db_session,
    *,
    fingerprint: str,
    prompt: str,
) -> AuthoringPromotionCandidate:
    row = AuthoringPromotionCandidate(
        source_key=f"test:{uuid.uuid4()}",
        plan_index=0,
        selected_candidate_id=f"candidate-{uuid.uuid4().hex[:8]}",
        contract_version=3,
        compiler_revision="design-plan-v3.0",
        prompt_revision="design-plan-v3-rag-grounded",
        family="solid",
        motif_count=0,
        retrieval_text=prompt,
        tags=["solid"],
        plan={
            "colors": ["#000000"],
            "ground_color_index": 0,
            "motifs": [],
            "layers": [],
        },
        structural_fingerprint=fingerprint,
        source_digest=uuid.uuid4().hex,
        embedding_model=MODEL,
        embedding_vertex=_vec(),
        status="pending",
        rule_reasons=["success", "selected", "finalized"],
    )
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)
    return row


async def test_candidate_review_activation_and_active_only_duplicate_policy(
    client,
    app,
    db_session,
    settings,
    monkeypatch,
):
    admin = await make_admin(db_session)
    manager = await make_user(db_session, role="manager")
    admin_headers = auth_headers(admin, settings)
    manager_headers = auth_headers(manager, settings)
    first = await _candidate(
        db_session,
        fingerprint="fingerprint-first",
        prompt="첫 번째 단색 패턴",
    )
    second = await _candidate(
        db_session,
        fingerprint="fingerprint-second",
        prompt="두 번째 단색 패턴",
    )
    ensure_embedding = AsyncMock(return_value={"embedding_model": MODEL})
    monkeypatch.setattr(
        app.state.worker,
        "ensure_authoring_promotion_embedding",
        ensure_embedding,
    )
    monkeypatch.setattr(
        app.state.worker,
        "current_authoring_embedding_model",
        AsyncMock(return_value={"model": MODEL}),
    )

    manager_list = await client.get(
        "/admin/authoring/candidates?status=pending",
        headers=manager_headers,
    )
    assert manager_list.status_code == 200
    assert manager_list.json()["total"] == 2
    denied = await client.post(
        f"/admin/authoring/candidates/{first.id}/decision",
        headers=manager_headers,
        json={
            "operation_id": str(uuid.uuid4()),
            "decision": "hold",
            "reason": "추가 검토 필요",
            "expected_review_version": 0,
        },
    )
    assert denied.status_code == 403

    held = await client.post(
        f"/admin/authoring/candidates/{first.id}/decision",
        headers=admin_headers,
        json={
            "operation_id": str(uuid.uuid4()),
            "decision": "hold",
            "reason": "색상 구성을 추가 검토",
            "expected_review_version": 0,
        },
    )
    assert held.status_code == 200
    assert held.json()["status"] == "hold"
    assert held.json()["review_version"] == 1

    approve_operation = str(uuid.uuid4())
    approve_payload = {
        "operation_id": approve_operation,
        "decision": "approve",
        "reason": "구조와 결과 품질 확인",
        "expected_review_version": 1,
    }
    approved = await client.post(
        f"/admin/authoring/candidates/{first.id}/decision",
        headers=admin_headers,
        json=approve_payload,
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    example_id = approved.json()["approved_example_id"]
    assert example_id is not None
    assert ensure_embedding.await_count == 1

    replay = await client.post(
        f"/admin/authoring/candidates/{first.id}/decision",
        headers=admin_headers,
        json=approve_payload,
    )
    assert replay.status_code == 200
    assert replay.json()["approved_example_id"] == example_id
    assert ensure_embedding.await_count == 1

    duplicate = await client.post(
        f"/admin/authoring/candidates/{second.id}/decision",
        headers=admin_headers,
        json={
            "operation_id": str(uuid.uuid4()),
            "decision": "approve",
            "reason": "두 번째 후보 품질 확인",
            "expected_review_version": 0,
        },
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "authoring_example_duplicate"

    example_detail = await client.get(
        f"/admin/authoring/examples/{example_id}",
        headers=manager_headers,
    )
    assert example_detail.status_code == 200
    assert example_detail.json()["active"] is True
    deactivated = await client.post(
        f"/admin/authoring/examples/{example_id}/activation",
        headers=admin_headers,
        json={
            "operation_id": str(uuid.uuid4()),
            "active": False,
            "expected_updated_at": example_detail.json()["updated_at"],
        },
    )
    assert deactivated.status_code == 200, deactivated.text
    assert deactivated.json()["active"] is False

    second_approved = await client.post(
        f"/admin/authoring/candidates/{second.id}/decision",
        headers=admin_headers,
        json={
            "operation_id": str(uuid.uuid4()),
            "decision": "approve",
            "reason": "비활성 예시는 중복 대상에서 제외",
            "expected_review_version": 0,
        },
    )
    assert second_approved.status_code == 200, second_approved.text
    assert second_approved.json()["status"] == "approved"

    reactivation_conflict = await client.post(
        f"/admin/authoring/examples/{example_id}/activation",
        headers=admin_headers,
        json={
            "operation_id": str(uuid.uuid4()),
            "active": True,
            "expected_updated_at": deactivated.json()["updated_at"],
        },
    )
    assert reactivation_conflict.status_code == 409
    assert reactivation_conflict.json()["code"] == "authoring_example_duplicate"

    db_session.expire_all()
    examples = list(await db_session.scalars(select(AuthoringExample)))
    assert len(examples) == 2
    assert sum(row.active for row in examples) == 1


async def test_rejected_candidate_is_terminal(client, db_session, settings):
    admin = await make_admin(db_session)
    candidate = await _candidate(
        db_session,
        fingerprint="rejected-fingerprint",
        prompt="거절할 패턴",
    )
    headers = auth_headers(admin, settings)
    rejected = await client.post(
        f"/admin/authoring/candidates/{candidate.id}/decision",
        headers=headers,
        json={
            "operation_id": str(uuid.uuid4()),
            "decision": "reject",
            "reason": "품질 기준 미달",
            "expected_review_version": 0,
        },
    )
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"
    retry = await client.post(
        f"/admin/authoring/candidates/{candidate.id}/decision",
        headers=headers,
        json={
            "operation_id": str(uuid.uuid4()),
            "decision": "approve",
            "reason": "결정을 다시 변경",
            "expected_review_version": 1,
        },
    )
    assert retry.status_code == 409
    assert retry.json()["code"] == "invalid_candidate_transition"


async def test_authored_example_preview_crud_permissions_and_optimistic_lock(
    client,
    app,
    db_session,
    settings,
    monkeypatch,
):
    admin = await make_admin(db_session)
    admin_id = admin.id
    manager = await make_user(db_session, role="manager")
    admin_headers = auth_headers(admin, settings)
    manager_headers = auth_headers(manager, settings)
    plan = {
        "colors": ["#F4EFE6", "#213547"],
        "ground_color_index": 0,
        "motifs": [{"source": "input", "input_index": 1}],
        "layers": [
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.18,
                "color_indices": [1],
                "placement": {
                    "type": "lattice",
                    "columns": 4,
                    "rows": 4,
                    "drop": "none",
                    "fixed_rotation_deg": 0,
                },
            }
        ],
    }

    async def _prepare(payload):
        return {
            "contract_version": 3,
            "family": "lattice",
            "motif_count": 1,
            "retrieval_text": payload["retrieval_text"].strip(),
            "tags": ["lattice", "input"],
            "plan": payload["plan"],
            "structural_fingerprint": "authored-solid-fingerprint",
            "source_digest": f"digest:{payload['retrieval_text'].strip()}",
            "embedding_model": MODEL,
            "embedding": _vec(),
        }

    preview = AsyncMock(
        return_value={
            "svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>',
            "warnings": [],
        }
    )
    prepare = AsyncMock(side_effect=_prepare)
    monkeypatch.setattr(app.state.worker, "preview_authoring_example", preview)
    monkeypatch.setattr(app.state.worker, "prepare_authoring_example", prepare)
    monkeypatch.setattr(
        app.state.worker,
        "current_authoring_embedding_model",
        AsyncMock(return_value={"model": MODEL}),
    )

    denied_preview = await client.post(
        "/admin/authoring/preview",
        headers=manager_headers,
        json={"plan": plan},
    )
    assert denied_preview.status_code == 403
    previewed = await client.post(
        "/admin/authoring/preview",
        headers=admin_headers,
        json={"plan": plan},
    )
    assert previewed.status_code == 200, previewed.text
    assert previewed.json()["svg"].startswith("<svg")

    denied_create = await client.post(
        "/admin/authoring/examples",
        headers=manager_headers,
        json={"retrieval_text": "매니저는 작성할 수 없는 시범", "plan": plan},
    )
    assert denied_create.status_code == 403
    created = await client.post(
        "/admin/authoring/examples",
        headers=admin_headers,
        json={
            "retrieval_text": "차분한 격자 넥타이 시범 패턴",
            "plan": plan,
            "motif_ids": ["studio-flower"],
        },
    )
    assert created.status_code == 201, created.text
    authored = created.json()
    assert authored["source"] == "authored"
    assert authored["active"] is False
    assert authored["embedding_model"] == MODEL
    assert authored["approved_by"] == str(admin.id)
    assert authored["motif_ids"] == ["studio-flower"]

    listed = await client.get(
        "/admin/authoring/examples?source=authored",
        headers=manager_headers,
    )
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()["items"]] == [authored["id"]]

    denied_update = await client.patch(
        f"/admin/authoring/examples/{authored['id']}",
        headers=manager_headers,
        json={
            "operation_id": str(uuid.uuid4()),
            "expected_updated_at": authored["updated_at"],
            "retrieval_text": "매니저가 바꾸려는 시범 패턴",
        },
    )
    assert denied_update.status_code == 403
    stale = await client.patch(
        f"/admin/authoring/examples/{authored['id']}",
        headers=admin_headers,
        json={
            "operation_id": str(uuid.uuid4()),
            "expected_updated_at": "2000-01-01T00:00:00Z",
            "retrieval_text": "오래된 화면에서 바꾸려는 시범 패턴",
        },
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "stale_resource"

    update_operation = uuid.uuid4()
    update_payload = {
        "operation_id": str(update_operation),
        "expected_updated_at": authored["updated_at"],
        "retrieval_text": "수정된 차분한 격자 넥타이 시범",
        "plan": plan,
    }
    updated = await client.patch(
        f"/admin/authoring/examples/{authored['id']}",
        headers=admin_headers,
        json=update_payload,
    )
    assert updated.status_code == 200, updated.text
    authored = updated.json()
    assert authored["retrieval_text"] == "수정된 차분한 격자 넥타이 시범"
    assert authored["motif_ids"] == ["studio-flower"]
    assert prepare.await_count == 2
    replayed_update = await client.patch(
        f"/admin/authoring/examples/{authored['id']}",
        headers=admin_headers,
        json=update_payload,
    )
    assert replayed_update.status_code == 200
    assert prepare.await_count == 2
    db_session.expire_all()
    update_log = await db_session.scalar(
        select(AdminOperationLog).where(AdminOperationLog.operation_id == str(update_operation))
    )
    assert update_log is not None
    assert update_log.actor_id == admin_id
    assert update_log.reason == ""
    assert update_log.before_data["state"]["plan"] == plan
    assert update_log.before_data["state"]["structural_fingerprint"] == (
        "authored-solid-fingerprint"
    )
    assert update_log.before_data["state"]["embedding_vertex"][0] == 1.0
    assert update_log.after_data["plan"] == plan
    assert update_log.after_data["structural_fingerprint"] == "authored-solid-fingerprint"
    assert update_log.after_data["embedding_vertex"][0] == 1.0

    activated = await client.post(
        f"/admin/authoring/examples/{authored['id']}/activation",
        headers=admin_headers,
        json={
            "operation_id": str(uuid.uuid4()),
            "active": True,
            "expected_updated_at": authored["updated_at"],
        },
    )
    assert activated.status_code == 200, activated.text

    active_update_operation = uuid.uuid4()
    active_updated = await client.patch(
        f"/admin/authoring/examples/{authored['id']}",
        headers=admin_headers,
        json={
            "operation_id": str(active_update_operation),
            "expected_updated_at": activated.json()["updated_at"],
            "retrieval_text": "활성 상태에서 보정한 격자 넥타이 시범",
        },
    )
    assert active_updated.status_code == 200, active_updated.text
    assert active_updated.json()["active"] is True
    assert active_updated.json()["motif_ids"] == ["studio-flower"]
    db_session.expire_all()
    active_update_log = await db_session.scalar(
        select(AdminOperationLog).where(
            AdminOperationLog.operation_id == str(active_update_operation)
        )
    )
    assert active_update_log is not None
    assert active_update_log.before_data["state"]["active"] is True
    assert active_update_log.after_data["active"] is True

    duplicate = await client.post(
        "/admin/authoring/examples",
        headers=admin_headers,
        json={"retrieval_text": "또 다른 단색 넥타이 시범 패턴", "plan": plan},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "authoring_example_duplicate"

    active_delete = await client.request(
        "DELETE",
        f"/admin/authoring/examples/{authored['id']}",
        headers=admin_headers,
        json={"operation_id": str(uuid.uuid4())},
    )
    assert active_delete.status_code == 409
    assert active_delete.json()["code"] == "authoring_example_active"

    bootstrap = AuthoringExample(
        example_id="bootstrap-delete-guard",
        source="bootstrap",
        contract_version=3,
        family="solid",
        motif_count=0,
        retrieval_text="삭제할 수 없는 초기 시범 패턴",
        tags=["solid"],
        plan=plan,
        structural_fingerprint="bootstrap-delete-guard",
        source_digest="bootstrap-delete-guard",
        embedding_model=MODEL,
        embedding_vertex=_vec(0.5),
        active=False,
        approved_at=datetime.now(UTC),
    )
    db_session.add(bootstrap)
    await db_session.commit()
    await db_session.refresh(bootstrap)

    bootstrap.embedding_model = "retired-embedding-model"
    await db_session.commit()
    await db_session.refresh(bootstrap)
    denied_stale_embedding_activation = await client.post(
        f"/admin/authoring/examples/{bootstrap.id}/activation",
        headers=admin_headers,
        json={
            "operation_id": str(uuid.uuid4()),
            "active": True,
            "expected_updated_at": bootstrap.updated_at.isoformat(),
        },
    )
    assert denied_stale_embedding_activation.status_code == 409
    assert denied_stale_embedding_activation.json()["code"] == "example_not_ready"

    deactivated = await client.post(
        f"/admin/authoring/examples/{authored['id']}/activation",
        headers=admin_headers,
        json={
            "operation_id": str(uuid.uuid4()),
            "active": False,
            "expected_updated_at": active_updated.json()["updated_at"],
        },
    )
    assert deactivated.status_code == 200, deactivated.text
    assert deactivated.json()["active_reason"] is None

    delete_operation = uuid.uuid4()
    delete_payload = {"operation_id": str(delete_operation)}
    deleted = await client.request(
        "DELETE",
        f"/admin/authoring/examples/{authored['id']}",
        headers=admin_headers,
        json=delete_payload,
    )
    assert deleted.status_code == 204
    replayed_delete = await client.request(
        "DELETE",
        f"/admin/authoring/examples/{authored['id']}",
        headers=admin_headers,
        json=delete_payload,
    )
    assert replayed_delete.status_code == 204
    db_session.expire_all()
    delete_log = await db_session.scalar(
        select(AdminOperationLog).where(AdminOperationLog.operation_id == str(delete_operation))
    )
    assert delete_log is not None
    assert delete_log.actor_id == admin_id
    assert delete_log.reason == ""
    assert delete_log.before_data["state"]["plan"] == plan
    assert delete_log.before_data["state"]["structural_fingerprint"] == (
        "authored-solid-fingerprint"
    )
    assert delete_log.before_data["state"]["embedding_vertex"][0] == 1.0
    assert delete_log.after_data == {"deleted": True}
    missing = await client.get(
        f"/admin/authoring/examples/{authored['id']}",
        headers=manager_headers,
    )
    assert missing.status_code == 404

    # bootstrap 시범도 수정·삭제 가능 (활성 중복이 없는 상태에서)
    await db_session.refresh(bootstrap)
    bootstrap_updated = await client.patch(
        f"/admin/authoring/examples/{bootstrap.id}",
        headers=admin_headers,
        json={
            "operation_id": str(uuid.uuid4()),
            "expected_updated_at": bootstrap.updated_at.isoformat(),
            "retrieval_text": "초기 시범을 직접 수정한 내용",
        },
    )
    assert bootstrap_updated.status_code == 200, bootstrap_updated.text
    assert bootstrap_updated.json()["source"] == "bootstrap"
    assert bootstrap_updated.json()["retrieval_text"] == "초기 시범을 직접 수정한 내용"
    assert bootstrap_updated.json()["embedding_model"] == MODEL

    bootstrap_deleted = await client.request(
        "DELETE",
        f"/admin/authoring/examples/{bootstrap.id}",
        headers=admin_headers,
        json={"operation_id": str(uuid.uuid4())},
    )
    assert bootstrap_deleted.status_code == 204

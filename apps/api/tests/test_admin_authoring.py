"""관리자 저작 예시 승격과 active RAG 집합 계약."""

import uuid
from unittest.mock import AsyncMock

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
            "reason": "품질 이슈로 즉시 제외",
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
            "reason": "다시 검색에 사용",
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

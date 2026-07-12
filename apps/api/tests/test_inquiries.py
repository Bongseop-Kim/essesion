"""1:1 문의 — 답변 전 본인 수정·삭제와 상태 가드."""

import asyncio

from db.models.commerce import Inquiry
from sqlalchemy import select

from .factories import auth_headers, make_admin, make_user


async def test_owner_can_update_and_delete_pending_inquiry(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    created = await client.post(
        "/inquiries",
        json={"category": "일반", "title": "원래 제목", "content": "원래 내용"},
        headers=headers,
    )
    inquiry_id = created.json()["id"]

    updated = await client.patch(
        f"/inquiries/{inquiry_id}",
        json={"category": "수선", "title": "수정 제목", "content": "수정 내용"},
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["category"] == "수선"
    assert updated.json()["title"] == "수정 제목"
    assert updated.json()["content"] == "수정 내용"

    deleted = await client.delete(f"/inquiries/{inquiry_id}", headers=headers)
    assert deleted.status_code == 204
    missing = await client.get(f"/inquiries/{inquiry_id}", headers=headers)
    assert missing.status_code == 404


async def test_answered_inquiry_cannot_be_updated_or_deleted(client, db_session, settings):
    user = await make_user(db_session)
    admin = await make_admin(db_session)
    inquiry = Inquiry(user_id=user.id, title="문의", content="내용")
    db_session.add(inquiry)
    await db_session.commit()
    await db_session.refresh(inquiry)

    answered = await client.post(
        f"/admin/inquiries/{inquiry.id}/answer",
        json={"answer": "답변입니다", "expected_updated_at": inquiry.updated_at.isoformat()},
        headers=auth_headers(admin, settings),
    )
    assert answered.status_code == 200
    headers = auth_headers(user, settings)

    update = await client.patch(
        f"/inquiries/{inquiry.id}", json={"title": "바꾸기"}, headers=headers
    )
    assert update.status_code == 400
    assert update.json()["code"] == "invalid_status"

    delete = await client.delete(f"/inquiries/{inquiry.id}", headers=headers)
    assert delete.status_code == 400
    assert delete.json()["code"] == "invalid_status"

    unchanged = await client.get(f"/inquiries/{inquiry.id}", headers=headers)
    assert unchanged.json()["title"] == "문의"
    assert unchanged.json()["status"] == "답변완료"


async def test_update_rejects_null_for_required_content_fields(client, db_session, settings):
    user = await make_user(db_session)
    inquiry = Inquiry(user_id=user.id, title="문의", content="내용")
    db_session.add(inquiry)
    await db_session.commit()
    headers = auth_headers(user, settings)

    for field in ("category", "title", "content"):
        response = await client.patch(
            f"/inquiries/{inquiry.id}", json={field: None}, headers=headers
        )
        assert response.status_code == 422, field

    clear_product = await client.patch(
        f"/inquiries/{inquiry.id}", json={"product_id": None}, headers=headers
    )
    assert clear_product.status_code == 200


async def test_admin_answer_waits_for_concurrent_delete_lock(client, db_session, settings):
    user = await make_user(db_session)
    admin = await make_admin(db_session)
    inquiry = Inquiry(user_id=user.id, title="경합 문의", content="내용")
    db_session.add(inquiry)
    await db_session.commit()
    await db_session.refresh(inquiry)

    locked = await db_session.scalar(
        select(Inquiry).where(Inquiry.id == inquiry.id).with_for_update()
    )
    assert locked is not None
    answer_task = asyncio.create_task(
        client.post(
            f"/admin/inquiries/{inquiry.id}/answer",
            json={"answer": "답변", "expected_updated_at": inquiry.updated_at.isoformat()},
            headers=auth_headers(admin, settings),
        )
    )
    await asyncio.sleep(0.1)
    assert not answer_task.done()

    await db_session.delete(locked)
    await db_session.commit()
    answered = await answer_task
    assert answered.status_code == 404

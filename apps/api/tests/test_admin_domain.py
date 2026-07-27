"""관리자 — 쿠폰 발급/회수 (domains.md §10)."""

from .factories import auth_headers, make_admin, make_coupon, make_user


async def test_bulk_issue_and_revoke(client, db_session, settings):
    admin = await make_admin(db_session)
    coupon = await make_coupon(db_session)
    user_a = await make_user(db_session)
    user_b = await make_user(db_session)
    headers = auth_headers(admin, settings)

    issued = await client.post(
        f"/admin/coupons/{coupon.id}/issue",
        json={
            "operation_id": "00000000-0000-0000-0000-000000000101",
            "reason": "테스트 고객 발급",
            "user_ids": [str(user_a.id), str(user_b.id)],
        },
        headers=headers,
    )
    assert issued.json()["affected_count"] == 2

    # 이미 활성인 고객은 중복 권리를 만들지 않는다.
    again = await client.post(
        f"/admin/coupons/{coupon.id}/issue",
        json={
            "operation_id": "00000000-0000-0000-0000-000000000102",
            "reason": "중복 발급 방지 확인",
            "user_ids": [str(user_a.id)],
        },
        headers=headers,
    )
    assert again.json()["affected_count"] == 0

    mine = (await client.get("/coupons/mine", headers=auth_headers(user_a, settings))).json()
    assert len(mine) == 1 and mine[0]["status"] == "active"

    revoked = await client.post(
        f"/admin/coupons/{coupon.id}/revoke-users",
        json={
            "operation_id": "00000000-0000-0000-0000-000000000103",
            "reason": "테스트 쿠폰 회수",
            "user_ids": [str(user_a.id)],
        },
        headers=headers,
    )
    assert revoked.json()["affected_count"] == 1

    # active만 회수 — 재회수는 0건
    twice = await client.post(
        f"/admin/coupons/{coupon.id}/revoke-users",
        json={
            "operation_id": "00000000-0000-0000-0000-000000000104",
            "reason": "중복 회수 방지 확인",
            "user_ids": [str(user_a.id)],
        },
        headers=headers,
    )
    assert twice.json()["affected_count"] == 0

"""관리자 — 쿠폰 발급/회수·통계 (domains.md §10)."""

from datetime import datetime
from zoneinfo import ZoneInfo

from .factories import auth_headers, make_admin, make_coupon, make_order, make_user

# 엔드포인트가 stat_date를 KST 하루로 해석하므로(admin/router.py) 날짜도 KST로 생성
# — UTC로 만들면 KST 00~09시(UTC 15~24시) 실행 시 하루 어긋나 flaky.
KST = ZoneInfo("Asia/Seoul")


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


async def test_stats(client, db_session, settings):
    admin = await make_admin(db_session)
    user = await make_user(db_session)
    await make_order(db_session, user, total_price=10000)
    await make_order(db_session, user, order_type="token", total_price=2500)
    headers = auth_headers(admin, settings)
    today = datetime.now(KST).date().isoformat()

    all_stats = await client.get("/admin/stats/today", params={"stat_date": today}, headers=headers)
    assert all_stats.json() == {"order_count": 2, "revenue": 12500}

    token_only = await client.get(
        "/admin/stats/today",
        params={"stat_date": today, "order_type": "token"},
        headers=headers,
    )
    assert token_only.json() == {"order_count": 1, "revenue": 2500}

    period = await client.get(
        "/admin/stats/period",
        params={"start_date": today, "end_date": today},
        headers=headers,
    )
    assert period.json()["order_count"] == 2

    bad = await client.get(
        "/admin/stats/period",
        params={"start_date": today, "end_date": "2020-01-01"},
        headers=headers,
    )
    assert bad.status_code == 400

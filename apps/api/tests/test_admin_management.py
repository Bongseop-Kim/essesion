"""고객·쿠폰·토큰·가격/설정 관리자 계약 — 실제 PostgreSQL."""

import asyncio
import uuid
from datetime import UTC, date, datetime, timedelta

from api.domains.admin.configuration import PRICE_CATEGORIES
from db.models.commerce import (
    AdminOperationLog,
    AdminSetting,
    PricingConstant,
    UserCoupon,
)
from db.models.tokens import DesignToken
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .factories import auth_headers, make_admin, make_coupon, make_user


async def _ensure_setting(db_session, key: str, value: str) -> None:
    await db_session.execute(
        pg_insert(AdminSetting)
        .values(key=key, value=value)
        .on_conflict_do_update(index_elements=[AdminSetting.key], set_={"value": value})
    )
    await db_session.commit()


async def _seed_all_pricing(db_session) -> None:
    for index, (key, category) in enumerate(PRICE_CATEGORIES.items(), start=1):
        db_session.add(PricingConstant(key=key, amount=index * 100, category=category))
    await db_session.commit()


async def test_customer_search_is_body_based_and_customer_only(client, db_session, settings):
    admin = await make_admin(db_session, email="needle-admin@test.local")
    customer = await make_user(
        db_session,
        email="needle-customer@test.local",
        phone="01012345678",
        name="검색 고객",
    )
    inactive = await make_user(db_session, email="needle-inactive@test.local")
    inactive.is_active = False
    customer.created_at = datetime(2026, 4, 30, 15, 0, tzinfo=UTC)
    inactive.created_at = datetime(2026, 4, 30, 14, 59, tzinfo=UTC)
    await db_session.commit()

    dated = await client.get(
        "/admin/customers",
        params={"start_date": "2026-05-01", "end_date": "2026-05-01"},
        headers=auth_headers(admin, settings),
    )
    assert dated.status_code == 200, dated.text
    assert [item["id"] for item in dated.json()["items"]] == [str(customer.id)]

    open_start = await client.get(
        "/admin/customers",
        params={"start_date": "2026-04-30"},
        headers=auth_headers(admin, settings),
    )
    assert open_start.status_code == 200, open_start.text
    assert {item["id"] for item in open_start.json()["items"]} == {
        str(customer.id),
        str(inactive.id),
    }

    response = await client.post(
        "/admin/customers/search",
        json={
            "q": "needle",
            "status": "active",
            "start_date": "2026-05-01",
            "end_date": "2026-05-01",
        },
        headers=auth_headers(admin, settings),
    )
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["id"] == str(customer.id)

    inactive_result = await client.post(
        "/admin/customers/search",
        json={
            "q": "needle",
            "status": "inactive",
            "start_date": "2026-04-30",
            "end_date": "2026-04-30",
        },
        headers=auth_headers(admin, settings),
    )
    assert inactive_result.json()["items"][0]["id"] == str(inactive.id)

    # privileged 계정은 customer detail로도 열리지 않는다.
    hidden = await client.get(f"/admin/customers/{admin.id}", headers=auth_headers(admin, settings))
    assert hidden.status_code == 404

    detail = await client.get(
        f"/admin/customers/{customer.id}", headers=auth_headers(admin, settings)
    )
    assert detail.status_code == 200
    assert detail.json()["token_balance"] == 0


async def test_admin_coupon_list_searches_names_and_exact_id(client, db_session, settings):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    target = await make_coupon(db_session)
    other = await make_coupon(db_session)
    target.name = "100% 할인 쿠폰"
    target.display_name = "VIP 여름 혜택"
    other.name = "1000 할인 쿠폰"
    other.display_name = "겨울 혜택"
    await db_session.commit()

    by_name = await client.get("/admin/coupons", params={"q": "100%"}, headers=headers)
    assert by_name.status_code == 200
    assert [item["id"] for item in by_name.json()["items"]] == [str(target.id)]

    by_display_name = await client.get("/admin/coupons", params={"q": "여름 혜택"}, headers=headers)
    assert by_display_name.status_code == 200
    assert [item["id"] for item in by_display_name.json()["items"]] == [str(target.id)]

    by_id = await client.get("/admin/coupons", params={"q": str(other.id)}, headers=headers)
    assert by_id.status_code == 200
    assert [item["id"] for item in by_id.json()["items"]] == [str(other.id)]

    too_short = await client.get("/admin/coupons", params={"q": "쿠"}, headers=headers)
    assert too_short.status_code == 400
    assert too_short.json()["code"] == "invalid_search"


async def test_admin_coupon_list_filters_status_and_kst_created_date(client, db_session, settings):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    previous = await make_coupon(db_session)
    target = await make_coupon(db_session)
    later = await make_coupon(db_session)
    previous.created_at = datetime(2026, 4, 30, 14, 59, tzinfo=UTC)
    target.created_at = datetime(2026, 4, 30, 15, 0, tzinfo=UTC)
    later.created_at = datetime(2026, 5, 1, 15, 0, tzinfo=UTC)
    previous.is_active = True
    target.is_active = True
    later.is_active = False
    await db_session.commit()

    exact_day = await client.get(
        "/admin/coupons",
        params={
            "status": "active",
            "start_date": "2026-05-01",
            "end_date": "2026-05-01",
        },
        headers=headers,
    )
    assert {item["id"] for item in exact_day.json()["items"]} == {str(target.id)}

    open_start = await client.get(
        "/admin/coupons", params={"start_date": "2026-05-02"}, headers=headers
    )
    assert {item["id"] for item in open_start.json()["items"]} == {str(later.id)}

    open_end = await client.get(
        "/admin/coupons", params={"end_date": "2026-04-30"}, headers=headers
    )
    assert {item["id"] for item in open_end.json()["items"]} == {str(previous.id)}

    invalid_range = await client.get(
        "/admin/coupons",
        params={"start_date": "2026-05-02", "end_date": "2026-05-01"},
        headers=headers,
    )
    assert invalid_range.status_code == 400
    assert invalid_range.json()["code"] == "invalid_range"


async def test_coupon_issue_snapshot_idempotency_and_target_filter(client, db_session, settings):
    admin = await make_admin(db_session)
    customer = await make_user(db_session)
    inactive = await make_user(db_session)
    inactive.is_active = False
    manager = await make_user(db_session, role="manager")
    coupon = await make_coupon(db_session, discount_type="percentage", discount_value=15)
    operation_id = uuid.uuid4()
    payload = {
        "operation_id": str(operation_id),
        "reason": "여름 고객 감사 발급",
        "user_ids": [str(customer.id), str(inactive.id), str(manager.id)],
    }

    issued = await client.post(
        f"/admin/coupons/{coupon.id}/issue",
        json=payload,
        headers=auth_headers(admin, settings),
    )
    assert issued.status_code == 200
    assert issued.json()["affected_count"] == 1

    replay = await client.post(
        f"/admin/coupons/{coupon.id}/issue",
        json=payload,
        headers=auth_headers(admin, settings),
    )
    assert replay.status_code == 200
    assert replay.json()["affected_count"] == 1

    collision = await client.post(
        f"/admin/coupons/{coupon.id}/issue",
        json={**payload, "reason": "다른 발급 사유"},
        headers=auth_headers(admin, settings),
    )
    assert collision.status_code == 409
    assert collision.json()["code"] == "operation_payload_conflict"

    issued_row = await db_session.scalar(
        select(UserCoupon).where(
            UserCoupon.coupon_id == coupon.id,
            UserCoupon.user_id == customer.id,
        )
    )
    assert issued_row is not None
    assert issued_row.terms_snapshot["discount_value"] == "15"
    assert (
        await db_session.scalar(
            select(func.count()).select_from(UserCoupon).where(UserCoupon.coupon_id == coupon.id)
        )
        == 1
    )

    operation = await db_session.scalar(
        select(AdminOperationLog).where(AdminOperationLog.operation_id == str(operation_id))
    )
    assert operation is not None
    assert operation.actor_id == admin.id
    assert operation.request_id

    denied = await client.post(
        f"/admin/coupons/{coupon.id}/issue",
        json={**payload, "operation_id": str(uuid.uuid4())},
        headers=auth_headers(manager, settings),
    )
    assert denied.status_code == 403


async def test_segment_coupon_issue_rejects_changed_preview_audience(client, db_session, settings):
    admin = await make_admin(db_session)
    await make_user(db_session)
    coupon = await make_coupon(db_session)
    headers = auth_headers(admin, settings)

    preview = await client.post(
        f"/admin/coupons/{coupon.id}/audience-preview",
        json={"segment": "all", "exclude_issued": True},
        headers=headers,
    )
    assert preview.status_code == 200
    assert preview.json()["total"] == 1

    # 확인 대화상자가 열린 뒤 고객군이 바뀌면 오래된 인원수로 발급하지 않는다.
    await make_user(db_session)
    operation_id = uuid.uuid4()
    stale = await client.post(
        f"/admin/coupons/{coupon.id}/issue",
        json={
            "operation_id": str(operation_id),
            "reason": "미리보기 고객군 발급",
            "segment": "all",
            "exclude_issued": True,
            "expected_count": 1,
        },
        headers=headers,
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "coupon_audience_changed"
    assert (
        await db_session.scalar(
            select(func.count()).select_from(UserCoupon).where(UserCoupon.coupon_id == coupon.id)
        )
        == 0
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(AdminOperationLog)
            .where(AdminOperationLog.operation_id == str(operation_id))
        )
        == 0
    )

    current = await client.post(
        f"/admin/coupons/{coupon.id}/issue",
        json={
            "operation_id": str(uuid.uuid4()),
            "reason": "갱신한 고객군 발급",
            "segment": "all",
            "exclude_issued": True,
            "expected_count": 2,
        },
        headers=headers,
    )
    assert current.status_code == 200
    assert current.json()["affected_count"] == 2


async def test_segment_coupon_issue_requires_expected_count(client, db_session, settings):
    admin = await make_admin(db_session)
    coupon = await make_coupon(db_session)
    response = await client.post(
        f"/admin/coupons/{coupon.id}/issue",
        json={
            "operation_id": str(uuid.uuid4()),
            "reason": "미리보기 없는 발급",
            "segment": "all",
        },
        headers=auth_headers(admin, settings),
    )
    assert response.status_code == 422


async def test_coupon_update_rejects_stale_revision(client, db_session, settings):
    admin = await make_admin(db_session)
    coupon = await make_coupon(db_session)
    headers = auth_headers(admin, settings)
    detail = await client.get(f"/admin/coupons/{coupon.id}", headers=headers)
    revision = detail.json()["updated_at"]

    updated = await client.patch(
        f"/admin/coupons/{coupon.id}",
        json={"expected_updated_at": revision, "display_name": "새 표시명"},
        headers=headers,
    )
    assert updated.status_code == 200

    stale = await client.patch(
        f"/admin/coupons/{coupon.id}",
        json={"expected_updated_at": revision, "display_name": "덮어쓰기"},
        headers=headers,
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "stale_resource"


async def test_coupon_names_are_normalized_and_conflicts_are_stable(client, db_session, settings):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    payload = {
        "name": "  중복 방지 쿠폰  ",
        "discount_type": "fixed",
        "discount_value": 1000,
        "expiry_date": (date.today() + timedelta(days=30)).isoformat(),
    }

    created = await client.post("/admin/coupons", json=payload, headers=headers)
    duplicate = await client.post(
        "/admin/coupons", json={**payload, "name": "중복 방지 쿠폰"}, headers=headers
    )
    blank = await client.post("/admin/coupons", json={**payload, "name": "   "}, headers=headers)

    assert created.status_code == 201
    assert created.json()["name"] == "중복 방지 쿠폰"
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "coupon_name_conflict"
    assert blank.status_code == 422
    assert blank.json()["code"] == "invalid_coupon_name"


async def test_token_adjustment_operation_is_idempotent(client, db_session, settings):
    admin = await make_admin(db_session)
    customer = await make_user(db_session)
    operation_id = uuid.uuid4()
    payload = {
        "operation_id": str(operation_id),
        "user_id": str(customer.id),
        "amount": 25,
        "description": "CS 보상 토큰 지급",
    }
    headers = auth_headers(admin, settings)

    first = await client.post("/admin/tokens/manage", json=payload, headers=headers)
    second = await client.post("/admin/tokens/manage", json=payload, headers=headers)
    assert first.status_code == second.status_code == 200
    assert first.json()["new_balance"] == second.json()["new_balance"] == 25
    assert (
        await db_session.scalar(
            select(func.count()).select_from(DesignToken).where(DesignToken.user_id == customer.id)
        )
        == 1
    )

    collision = await client.post(
        "/admin/tokens/manage",
        json={**payload, "amount": 30},
        headers=headers,
    )
    assert collision.status_code == 409

    privileged = await client.post(
        "/admin/tokens/manage",
        json={
            **payload,
            "operation_id": str(uuid.uuid4()),
            "user_id": str(admin.id),
        },
        headers=headers,
    )
    assert privileged.status_code == 404


async def test_concurrent_token_adjustment_replays_one_operation(client, db_session, settings):
    admin = await make_admin(db_session)
    customer = await make_user(db_session)
    payload = {
        "operation_id": str(uuid.uuid4()),
        "user_id": str(customer.id),
        "amount": 7,
        "description": "동시 요청 멱등성 검증",
    }
    headers = auth_headers(admin, settings)

    first, second = await asyncio.gather(
        client.post("/admin/tokens/manage", json=payload, headers=headers),
        client.post("/admin/tokens/manage", json=payload, headers=headers),
    )

    assert first.status_code == second.status_code == 200
    assert first.json()["new_balance"] == second.json()["new_balance"] == 7
    assert (
        await db_session.scalar(
            select(func.count()).select_from(DesignToken).where(DesignToken.user_id == customer.id)
        )
        == 1
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(AdminOperationLog)
            .where(AdminOperationLog.operation_id == payload["operation_id"])
        )
        == 1
    )


async def test_pricing_and_settings_are_allowlisted_atomic_and_admin_only(
    client, db_session, settings
):
    admin = await make_admin(db_session)
    manager = await make_user(db_session, role="manager")
    await _seed_all_pricing(db_session)
    await _ensure_setting(db_session, "default_courier_company", "롯데택배")
    await _ensure_setting(db_session, "design_token_initial_grant", "30")
    admin_headers = auth_headers(admin, settings)

    pricing = await client.get("/admin/pricing", headers=admin_headers)
    assert pricing.status_code == 200
    row = next(item for item in pricing.json() if item["key"] == "REFORM_SHIPPING_COST")
    request = {
        "operation_id": str(uuid.uuid4()),
        "reason": "택배 계약 단가 반영",
        "items": [
            {
                "key": row["key"],
                "amount": row["amount"] + 500,
                "expected_updated_at": row["updated_at"],
            }
        ],
    }
    updated = await client.put("/admin/pricing", json=request, headers=admin_headers)
    assert updated.status_code == 200
    assert (
        next(item for item in updated.json() if item["key"] == row["key"])["amount"]
        == row["amount"] + 500
    )

    replay = await client.put("/admin/pricing", json=request, headers=admin_headers)
    assert replay.status_code == 200
    stale = await client.put(
        "/admin/pricing",
        json={**request, "operation_id": str(uuid.uuid4())},
        headers=admin_headers,
    )
    assert stale.status_code == 409

    manager_denied = await client.put(
        "/admin/pricing",
        json={**request, "operation_id": str(uuid.uuid4())},
        headers=auth_headers(manager, settings),
    )
    assert manager_denied.status_code == 403

    settings_rows = await client.get("/admin/settings", headers=admin_headers)
    courier = next(
        item for item in settings_rows.json() if item["key"] == "default_courier_company"
    )
    setting_update = await client.put(
        "/admin/settings",
        json={
            "operation_id": str(uuid.uuid4()),
            "reason": "기본 출고 택배사 변경",
            "items": [
                {
                    "key": "default_courier_company",
                    "value": "cj",
                    "expected_updated_at": courier["updated_at"],
                }
            ],
        },
        headers=admin_headers,
    )
    assert setting_update.status_code == 200
    assert (
        next(item for item in setting_update.json() if item["key"] == "default_courier_company")[
            "value"
        ]
        == "cj"
    )


async def test_dormant_coupon_audience_uses_latest_completed_order(client, db_session, settings):
    from db.models.commerce import Order

    admin = await make_admin(db_session)
    dormant = await make_user(db_session, name="휴면 고객")
    recent = await make_user(db_session, name="최근 고객")
    coupon = await make_coupon(db_session)
    db_session.add_all(
        [
            Order(
                user_id=dormant.id,
                order_number=f"ORD-DORMANT-{uuid.uuid4().hex[:8]}",
                order_type="sale",
                status="완료",
                total_price=1000,
                original_price=1000,
                created_at=datetime.now(UTC) - timedelta(days=100),
            ),
            Order(
                user_id=recent.id,
                order_number=f"ORD-RECENT-{uuid.uuid4().hex[:8]}",
                order_type="sale",
                status="완료",
                total_price=1000,
                original_price=1000,
                created_at=datetime.now(UTC) - timedelta(days=10),
            ),
        ]
    )
    await db_session.commit()

    response = await client.post(
        f"/admin/coupons/{coupon.id}/audience-preview",
        json={"segment": "dormant"},
        headers=auth_headers(admin, settings),
    )
    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [str(dormant.id)]

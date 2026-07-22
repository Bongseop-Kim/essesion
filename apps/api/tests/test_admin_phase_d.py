"""Admin Phase D — claim outbox/read model and payment incident recovery."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from api.domains.admin import payment_incidents
from api.domains.claims import service as claim_service
from api.domains.payments import service as payment_service
from api.integrations.toss import TossResult
from db.models.auth import User
from db.models.commerce import (
    AdminOperationLog,
    Claim,
    ClaimNotificationLog,
    ClaimStatusLog,
    Order,
    OrderItem,
    OrderStatusLog,
    PaymentIncident,
    RepairPickupRequest,
    RepairShippingReceipt,
)
from db.models.tokens import DesignToken
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from .factories import (
    auth_headers,
    make_address,
    make_admin,
    make_order,
    make_token_refund_claim,
    make_user,
)

KST = ZoneInfo("Asia/Seoul")


async def _order_with_item(db_session, user, **order_kwargs):
    order = await make_order(db_session, user, **order_kwargs)
    item = OrderItem(
        order_id=order.id,
        item_id=f"phase-d:{order.id}",
        item_type="product",
        item_data={"name": "거래 시점 상품", "option_name": "Navy"},
        quantity=2,
        unit_price=5000,
    )
    db_session.add(item)
    await db_session.commit()
    await db_session.refresh(item)
    return order, item


class _FailingSolapi:
    capability_mode = "unavailable"

    async def send_sms(self, *args: Any, **kwargs: Any) -> bool:
        return False

    async def send_alimtalk(self, *args: Any, **kwargs: Any) -> bool:
        return False


class _ScriptedToss:
    capability_mode = "real"

    def __init__(self) -> None:
        self.confirm_exception: Exception | None = None
        self.cancel_exception: Exception | None = None
        self.confirm_calls = 0
        self.cancel_calls = 0
        self.lookups: dict[str, TossResult] = {}
        self.before_confirm: Any = None
        self.before_cancel: Any = None

    async def confirm(self, payment_key: str, order_id: str, amount: int) -> TossResult:
        self.confirm_calls += 1
        if self.before_confirm is not None:
            await self.before_confirm()
        if self.confirm_exception is not None:
            raise self.confirm_exception
        return TossResult(
            ok=True,
            status=200,
            body={"status": "DONE", "orderId": order_id, "totalAmount": amount},
        )

    async def cancel(
        self,
        payment_key: str,
        reason: str,
        cancel_amount: int | None = None,
    ) -> TossResult:
        self.cancel_calls += 1
        if self.before_cancel is not None:
            await self.before_cancel()
        if self.cancel_exception is not None:
            raise self.cancel_exception
        return TossResult(ok=True, status=200, body={"status": "CANCELED"})

    async def get_payment(self, payment_key: str) -> TossResult:
        return self.lookups[payment_key]

    async def aclose(self) -> None:
        pass


async def test_claim_list_detail_shipping_timeline_and_safe_photos(client, db_session, settings):
    manager = await make_user(db_session, role="manager", name="운영 매니저")
    customer = await make_user(
        db_session,
        name="클레임 고객",
        phone="01011112222",
    )
    address = await make_address(db_session, customer)
    order, item = await _order_with_item(
        db_session,
        customer,
        order_type="sale",
        status="배송완료",
        shipping_address_id=address.id,
    )
    order.shipping_address_snapshot = {
        "id": str(address.id),
        "recipient_name": "거래시점 수령인",
        "recipient_phone": "01099998888",
        "postal_code": "04524",
        "address": "서울시 거래시점로 1",
        "address_detail": "101호",
        "delivery_memo": "문 앞",
        "delivery_request": None,
    }
    order.courier_company = "CJ"
    order.tracking_number = "ORDER-TRACK"
    order.company_courier_company = "한진"
    order.company_tracking_number = "COMPANY-TRACK"
    claim = Claim(
        user_id=customer.id,
        order_id=order.id,
        order_item_id=item.id,
        claim_number="CLM-PHASE-D-001",
        type="exchange",
        status="재발송",
        reason="size_mismatch",
        description="교환 상세",
        quantity=1,
        return_courier_company="우체국",
        return_tracking_number="RETURN-TRACK",
        resend_courier_company="롯데",
        resend_tracking_number="RESEND-TRACK",
    )
    db_session.add(claim)
    await db_session.flush()
    db_session.add_all(
        [
            ClaimStatusLog(
                claim_id=claim.id,
                changed_by=manager.id,
                previous_status="수거완료",
                new_status="재발송",
                memo="검수 완료",
                request_id="req-claim",
            ),
            OrderStatusLog(
                order_id=order.id,
                changed_by=manager.id,
                previous_status="배송중",
                new_status="배송완료",
                memo="배송 확인",
                request_id="req-order",
            ),
            RepairPickupRequest(
                order_id=order.id,
                recipient_name="수거인",
                recipient_phone="01033334444",
                postal_code="12345",
                address="서울시 수거로 2",
                detail_address="202호",
                pickup_fee=4500,
            ),
            RepairShippingReceipt(
                order_id=order.id,
                receipt_type="tracking",
                memo="고객 발송",
                photos=[
                    {"object_key": "private/claim/photo-1.jpg"},
                    {"object_key": "private/claim/photo-2.jpg"},
                ],
            ),
            ClaimNotificationLog(
                claim_id=claim.id,
                status="완료",
                delivery_status="failed",
                attempts=2,
                last_error="solapi_delivery_failed",
            ),
            PaymentIncident(
                operation_id=str(uuid.uuid4()),
                incident_type="refund",
                status="open",
                request_id="req-incident",
                actor_id=manager.id,
                order_id=order.id,
                claim_id=claim.id,
                expected_amount=5000,
                details={"paymentKey": "must-not-leak"},
            ),
        ]
    )
    await db_session.commit()

    today_date = datetime.now(KST).date()
    today = today_date.isoformat()
    listed = await client.get(
        "/admin/claims",
        params={
            "claim_type": "exchange",
            "status": "재발송",
            "start_date": today,
            "end_date": today,
            "q": "PHASE-D",
            "limit": 1,
        },
        headers=auth_headers(manager, settings),
    )
    assert listed.status_code == 200, listed.text
    assert listed.json()["total"] == 1
    assert listed.json()["limit"] == 1
    assert listed.json()["items"][0]["claim_number"] == claim.claim_number
    assert listed.json()["items"][0]["admin_actions"][0]["target_status"] == "완료"

    open_start = await client.get(
        "/admin/claims",
        params={
            "start_date": (today_date - timedelta(days=1)).isoformat(),
            "q": "PHASE-D",
        },
        headers=auth_headers(manager, settings),
    )
    assert open_start.status_code == 200, open_start.text
    assert [item["id"] for item in open_start.json()["items"]] == [str(claim.id)]

    open_end = await client.get(
        "/admin/claims",
        params={
            "end_date": (today_date + timedelta(days=1)).isoformat(),
            "q": "PHASE-D",
        },
        headers=auth_headers(manager, settings),
    )
    assert open_end.status_code == 200, open_end.text
    assert [item["id"] for item in open_end.json()["items"]] == [str(claim.id)]

    detail = await client.get(f"/admin/claims/{claim.id}", headers=auth_headers(manager, settings))
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["shipping"]["shipping_address"]["recipient_name"] == "거래시점 수령인"
    assert body["shipping"]["return_tracking_number"] == "RETURN-TRACK"
    assert body["shipping"]["resend_tracking_number"] == "RESEND-TRACK"
    assert body["shipping"]["repair_pickup"]["pickup_fee"] == 4500
    assert body["shipping"]["repair_receipts"][0]["photo_count"] == 2
    assert "private/claim" not in detail.text
    assert body["status_logs"][0]["request_id"] == "req-claim"
    assert {event["event_type"] for event in body["timeline"]} == {
        "claim_created",
        "claim_status",
        "order_status",
        "repair_shipping",
        "notification",
    }
    assert body["notifications"][0]["delivery_status"] == "failed"
    assert body["payment_incidents"][0]["status"] == "open"
    assert {action["kind"] for action in body["tracking_actions"]} == {"return", "resend"}

    short_search = await client.get(
        "/admin/claims",
        params={"q": "x"},
        headers=auth_headers(manager, settings),
    )
    assert short_search.status_code == 400


async def test_claim_tracking_update_is_validated_idempotent_and_audited(
    client, db_session, settings
):
    manager = await make_user(db_session, role="manager")
    customer = await make_user(db_session)
    order, item = await _order_with_item(db_session, customer, status="배송완료")
    claim = Claim(
        user_id=customer.id,
        order_id=order.id,
        order_item_id=item.id,
        claim_number="CLM-PHASE-D-TRACKING",
        type="exchange",
        status="재발송",
        reason="size_mismatch",
        quantity=1,
    )
    db_session.add(claim)
    await db_session.commit()

    operation_id = uuid.uuid4()
    payload = {
        "operation_id": str(operation_id),
        "kind": "resend",
        "courier_company": "CJ대한통운",
        "tracking_number": "1234-5678-9012",
        "memo": "교환품 출고 송장 등록",
    }
    headers = {**auth_headers(manager, settings), "X-Request-ID": "claim-tracking-request"}
    updated = await client.patch(
        f"/admin/claims/{claim.id}/tracking",
        json=payload,
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["shipping"]["resend_courier_company"] == "CJ대한통운"
    assert updated.json()["shipping"]["resend_tracking_number"] == "1234-5678-9012"
    shipping_event = next(
        event for event in updated.json()["timeline"] if event["event_type"] == "claim_shipping"
    )
    assert shipping_event["actor_id"] == str(manager.id)
    assert shipping_event["metadata"]["request_id"] == "claim-tracking-request"

    repeated = await client.patch(
        f"/admin/claims/{claim.id}/tracking",
        json=payload,
        headers=headers,
    )
    assert repeated.status_code == 200
    logs = list(
        await db_session.scalars(
            select(AdminOperationLog).where(AdminOperationLog.operation_id == str(operation_id))
        )
    )
    assert len(logs) == 1
    assert logs[0].actor_id == manager.id
    assert logs[0].request_id == "claim-tracking-request"
    assert logs[0].before_data["state"]["tracking_number"] is None
    assert logs[0].after_data["tracking_number"] == "1234-5678-9012"

    conflict = await client.patch(
        f"/admin/claims/{claim.id}/tracking",
        json={**payload, "tracking_number": "9999-9999"},
        headers=headers,
    )
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "operation_payload_conflict"

    claim.status = "처리중"
    await db_session.commit()
    invalid_status = await client.patch(
        f"/admin/claims/{claim.id}/tracking",
        json={**payload, "operation_id": str(uuid.uuid4())},
        headers=headers,
    )
    assert invalid_status.status_code == 400
    assert invalid_status.json()["code"] == "invalid_tracking_status"


async def test_claim_terminal_outbox_is_atomic_and_retry_safe(app, client, db_session, settings):
    admin = await make_admin(db_session)
    customer = await make_user(db_session, phone="01012345678")
    customer.notification_consent = True
    customer.notification_enabled = True
    customer.phone_verified = True
    order, item = await _order_with_item(db_session, customer, status="진행중")
    claim = Claim(
        user_id=customer.id,
        order_id=order.id,
        order_item_id=item.id,
        claim_number="CLM-PHASE-D-OUTBOX",
        type="cancel",
        status="처리중",
        reason="other",
        quantity=1,
    )
    db_session.add(claim)
    await db_session.commit()

    await claim_service.admin_update_status(
        db_session,
        admin,
        claim.id,
        "완료",
        "처리 완료",
        False,
    )
    notification = await db_session.scalar(
        select(ClaimNotificationLog).where(ClaimNotificationLog.claim_id == claim.id)
    )
    assert notification is not None
    assert notification.delivery_status == "pending"
    assert notification.attempts == 0

    assert (
        await claim_service.deliver_notification(
            db_session,
            _FailingSolapi(),
            settings,
            notification.id,
        )
        == "delivery_failed"
    )
    await db_session.refresh(notification)
    assert (notification.delivery_status, notification.attempts) == ("failed", 1)

    retried = await client.post(
        f"/admin/claim-notifications/{notification.id}/retry",
        headers=auth_headers(admin, settings),
    )
    assert retried.status_code == 200, retried.text
    assert retried.json()["delivery_status"] == "sent"
    assert retried.json()["attempts"] == 2
    assert len(app.state.solapi.sent) == 1

    repeated = await client.post(
        f"/admin/claim-notifications/{notification.id}/retry",
        headers=auth_headers(admin, settings),
    )
    assert repeated.status_code == 200
    assert repeated.json()["attempts"] == 2
    assert len(app.state.solapi.sent) == 1

    rollback_order, rollback_item = await _order_with_item(db_session, customer, status="진행중")
    rollback_claim = Claim(
        user_id=customer.id,
        order_id=rollback_order.id,
        order_item_id=rollback_item.id,
        claim_number="CLM-PHASE-D-ROLLBACK",
        type="cancel",
        status="처리중",
        reason="other",
        quantity=1,
    )
    db_session.add(rollback_claim)
    await db_session.commit()
    missing_admin = User(id=uuid.uuid4(), name="없는 관리자", role="admin")
    with pytest.raises(IntegrityError):
        await claim_service.admin_update_status(
            db_session,
            missing_admin,
            rollback_claim.id,
            "완료",
            None,
            False,
        )
    await db_session.rollback()
    await db_session.refresh(rollback_claim)
    assert rollback_claim.status == "처리중"
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(ClaimNotificationLog)
            .where(ClaimNotificationLog.claim_id == rollback_claim.id)
        )
        == 0
    )


async def test_payment_incident_permissions_reconcile_resolve_and_idempotence(
    app, client, db_session, settings
):
    admin = await make_admin(db_session)
    manager = await make_user(db_session, role="manager")
    customer = await make_user(db_session)
    order = await make_order(db_session, customer, status="결제중", total_price=12000)
    order.payment_key = "phase-d-reconcile-key"
    incident = PaymentIncident(
        operation_id=str(uuid.uuid4()),
        incident_type="confirm",
        status="open",
        request_id="req-payment",
        actor_id=customer.id,
        order_id=order.id,
        expected_amount=12000,
        details={
            "lookup_payment_key": "phase-d-reconcile-key",
            "authorization": "secret-header",
            "nested": {"phone": "01000000000"},
        },
    )
    db_session.add(incident)
    await db_session.commit()

    manager_headers = auth_headers(manager, settings)
    listed = await client.get("/admin/payment-incidents", headers=manager_headers)
    assert listed.status_code == 200
    assert listed.json()["total"] == 1

    yesterday = (datetime.now(KST).date() - timedelta(days=1)).isoformat()
    by_text_and_open_date = await client.get(
        "/admin/payment-incidents",
        params={"q": "req-payment", "start_date": yesterday},
        headers=manager_headers,
    )
    assert by_text_and_open_date.status_code == 200, by_text_and_open_date.text
    assert [item["id"] for item in by_text_and_open_date.json()["items"]] == [str(incident.id)]

    by_operation_id = await client.get(
        "/admin/payment-incidents",
        params={"q": incident.operation_id[:8]},
        headers=manager_headers,
    )
    assert [item["id"] for item in by_operation_id.json()["items"]] == [str(incident.id)]

    by_incident_id = await client.get(
        "/admin/payment-incidents",
        params={"q": str(incident.id)},
        headers=manager_headers,
    )
    assert [item["id"] for item in by_incident_id.json()["items"]] == [str(incident.id)]

    by_order_id = await client.get(
        "/admin/payment-incidents",
        params={"q": str(order.id)},
        headers=manager_headers,
    )
    assert [item["id"] for item in by_order_id.json()["items"]] == [str(incident.id)]

    short_search = await client.get(
        "/admin/payment-incidents", params={"q": "x"}, headers=manager_headers
    )
    assert short_search.status_code == 422

    long_search = await client.get(
        "/admin/payment-incidents", params={"q": "x" * 129}, headers=manager_headers
    )
    assert long_search.status_code == 422

    detail = await client.get(f"/admin/payment-incidents/{incident.id}", headers=manager_headers)
    assert detail.status_code == 200
    assert detail.json()["details"]["lookup_payment_key"] == "[redacted]"
    assert detail.json()["details"]["authorization"] == "[redacted]"
    assert detail.json()["details"]["nested"]["phone"] == "[redacted]"
    assert all(not action["enabled"] for action in detail.json()["admin_actions"])

    manager_reconcile = await client.post(
        f"/admin/payment-incidents/{incident.id}/reconcile",
        headers=manager_headers,
    )
    assert manager_reconcile.status_code == 403
    manager_resolve = await client.post(
        f"/admin/payment-incidents/{incident.id}/resolve",
        json={"operation_id": str(uuid.uuid4()), "memo": "금액 확인"},
        headers=manager_headers,
    )
    assert manager_resolve.status_code == 403

    admin_headers = auth_headers(admin, settings)
    before_reconcile = await client.post(
        f"/admin/payment-incidents/{incident.id}/resolve",
        json={"operation_id": str(uuid.uuid4()), "memo": "금액 확인"},
        headers=admin_headers,
    )
    assert before_reconcile.status_code == 409
    assert before_reconcile.json()["code"] == "reconciliation_required"

    toss = _ScriptedToss()
    payment_key = order.payment_key
    assert payment_key is not None
    toss.lookups[payment_key] = TossResult(
        ok=True,
        status=200,
        body={
            "paymentKey": payment_key,
            "status": "DONE",
            "orderId": str(order.payment_group_id),
            "totalAmount": 12000,
        },
    )
    old_toss = app.state.toss
    app.state.toss = toss
    reconciled = await client.post(
        f"/admin/payment-incidents/{incident.id}/reconcile",
        headers=admin_headers,
    )
    app.state.toss = old_toss
    assert reconciled.status_code == 200, reconciled.text
    evidence = reconciled.json()["details"]["reconciliation"]
    assert evidence["domain_consistent"] is True
    assert evidence["apply_result"] == "applied"
    assert (
        next(
            action for action in reconciled.json()["admin_actions"] if action["kind"] == "resolve"
        )["enabled"]
        is True
    )
    await db_session.refresh(order)
    assert order.status == "진행중"

    operation_id = uuid.uuid4()
    resolved = await client.post(
        f"/admin/payment-incidents/{incident.id}/resolve",
        json={"operation_id": str(operation_id), "memo": "Toss와 내부 상태 대사 완료"},
        headers=admin_headers,
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "resolved"
    repeated = await client.post(
        f"/admin/payment-incidents/{incident.id}/resolve",
        json={"operation_id": str(operation_id), "memo": "Toss와 내부 상태 대사 완료"},
        headers=admin_headers,
    )
    assert repeated.status_code == 200
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(AdminOperationLog)
            .where(AdminOperationLog.operation_id == str(operation_id))
        )
        == 1
    )
    conflict = await client.post(
        f"/admin/payment-incidents/{incident.id}/resolve",
        json={"operation_id": str(operation_id), "memo": "다른 내용"},
        headers=admin_headers,
    )
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "operation_payload_conflict"

    fresh_list = await client.get("/admin/payment-incidents", headers=manager_headers)
    assert fresh_list.json()["total"] == 0

    rollback_incident = PaymentIncident(
        operation_id=str(uuid.uuid4()),
        incident_type="confirm",
        status="open",
        request_id="req-rollback",
        order_id=order.id,
        expected_amount=12000,
        observed_amount=12000,
        details={
            "lookup_payment_key": order.payment_key,
            "reconciliation": {
                "checked_at": datetime.now(UTC).isoformat(),
                "provider_ok": True,
                "provider_order_id_matches": True,
                "provider_status_matches": True,
                "amount_matches": True,
                "domain_consistent": True,
            },
        },
    )
    db_session.add(rollback_incident)
    await db_session.commit()
    failed_operation_id = uuid.uuid4()
    with pytest.raises(IntegrityError):
        await payment_incidents.resolve_incident(
            db_session,
            incident_id=rollback_incident.id,
            actor_id=uuid.uuid4(),
            operation_id=failed_operation_id,
            memo="FK 실패로 전체 롤백",
            request_id="req-test",
        )
    await db_session.rollback()
    await db_session.refresh(rollback_incident)
    assert rollback_incident.status == "open"
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(AdminOperationLog)
            .where(AdminOperationLog.operation_id == str(failed_operation_id))
        )
        == 0
    )


@pytest.mark.parametrize(
    ("incident_type", "provider_status", "payment_fields", "observed_amount"),
    [
        (
            "partial_cancel",
            "PARTIAL_CANCELED",
            {"balanceAmount": 9000, "cancels": [{"cancelAmount": 3000}]},
            3000,
        ),
    ],
)
async def test_manual_payment_incident_can_resolve_after_fresh_provider_evidence(
    app,
    client,
    db_session,
    settings,
    incident_type,
    provider_status,
    payment_fields,
    observed_amount,
):
    admin = await make_admin(db_session)
    customer = await make_user(db_session)
    order = await make_order(db_session, customer, status="진행중", total_price=12000)
    order.payment_key = f"manual-{incident_type}-key"
    incident = PaymentIncident(
        operation_id=str(uuid.uuid4()),
        incident_type=incident_type,
        status="open",
        request_id="req-manual-incident",
        order_id=order.id,
        expected_amount=order.total_price,
        observed_amount=observed_amount,
        details={
            "phase": "webhook_manual_review",
            "provider_status": provider_status,
            "lookup_payment_key": order.payment_key,
        },
    )
    db_session.add(incident)
    await db_session.commit()

    toss = _ScriptedToss()
    payment_key = order.payment_key
    assert payment_key is not None
    toss.lookups[payment_key] = TossResult(
        ok=True,
        status=200,
        body={
            "paymentKey": payment_key,
            "status": provider_status,
            "orderId": str(order.payment_group_id),
            "totalAmount": order.total_price,
            **payment_fields,
        },
    )
    old_toss = app.state.toss
    app.state.toss = toss
    try:
        reconciled = await client.post(
            f"/admin/payment-incidents/{incident.id}/reconcile",
            headers=auth_headers(admin, settings),
        )
    finally:
        app.state.toss = old_toss

    assert reconciled.status_code == 200, reconciled.text
    evidence = reconciled.json()["details"]["reconciliation"]
    assert evidence["domain_consistent"] is False
    assert evidence["manual_resolution_allowed"] is True
    assert evidence["amount_matches"] is True
    assert reconciled.json()["observed_amount"] == observed_amount
    resolve_action = next(
        action for action in reconciled.json()["admin_actions"] if action["kind"] == "resolve"
    )
    assert resolve_action["enabled"] is True

    resolved = await client.post(
        f"/admin/payment-incidents/{incident.id}/resolve",
        json={"operation_id": str(uuid.uuid4()), "memo": "Toss 증거 확인 후 수동 조치 완료"},
        headers=auth_headers(admin, settings),
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "resolved"


async def test_manual_partial_cancel_rejects_unverified_amount(app, client, db_session, settings):
    admin = await make_admin(db_session)
    customer = await make_user(db_session)
    order = await make_order(db_session, customer, status="진행중", total_price=12000)
    order.payment_key = "manual-partial-invalid-amount"
    incident = PaymentIncident(
        operation_id=str(uuid.uuid4()),
        incident_type="partial_cancel",
        status="open",
        request_id="req-manual-amount",
        order_id=order.id,
        expected_amount=order.total_price,
        details={
            "provider_status": "PARTIAL_CANCELED",
            "lookup_payment_key": order.payment_key,
        },
    )
    db_session.add(incident)
    await db_session.commit()

    toss = _ScriptedToss()
    payment_key = order.payment_key
    assert payment_key is not None
    toss.lookups[payment_key] = TossResult(
        ok=True,
        status=200,
        body={
            "paymentKey": payment_key,
            "status": "PARTIAL_CANCELED",
            "orderId": str(order.payment_group_id),
            "totalAmount": order.total_price + 1,
            "balanceAmount": 9001,
            "cancels": [{"cancelAmount": 3000}],
        },
    )
    old_toss = app.state.toss
    app.state.toss = toss
    try:
        reconciled = await client.post(
            f"/admin/payment-incidents/{incident.id}/reconcile",
            headers=auth_headers(admin, settings),
        )
    finally:
        app.state.toss = old_toss

    assert reconciled.status_code == 200
    evidence = reconciled.json()["details"]["reconciliation"]
    assert evidence["amount_matches"] is False
    assert evidence["manual_resolution_allowed"] is False
    blocked = await client.post(
        f"/admin/payment-incidents/{incident.id}/resolve",
        json={"operation_id": str(uuid.uuid4()), "memo": "검증 없이 닫기"},
        headers=auth_headers(admin, settings),
    )
    assert blocked.status_code == 409
    assert blocked.json()["code"] == "reconciliation_required"


async def test_ambiguous_money_operations_create_incidents_and_block_blind_retry(
    app, client, db_session, settings, monkeypatch
):
    admin = await make_admin(db_session)
    manager = await make_user(db_session, role="manager")
    customer = await make_user(db_session)
    toss = _ScriptedToss()
    old_toss = app.state.toss
    app.state.toss = toss

    confirm_order = await make_order(
        db_session,
        customer,
        status="대기중",
        total_price=15000,
    )
    original_confirm = payment_service._confirm

    async def assert_confirm_operation_is_durable() -> None:
        async with app.state.sessionmaker() as verification:
            prepared = await verification.scalar(
                select(PaymentIncident).where(
                    PaymentIncident.order_id == confirm_order.id,
                    PaymentIncident.incident_type == "confirm",
                    PaymentIncident.status == "open",
                )
            )
            assert prepared is not None
            assert prepared.details["phase"] == "provider_call_pending"

    toss.before_confirm = assert_confirm_operation_is_durable

    async def _db_failure(*args: Any, **kwargs: Any):
        raise RuntimeError("simulated db apply failure")

    monkeypatch.setattr(payment_service, "_confirm", _db_failure)
    confirm = await client.post(
        "/payments/confirm",
        json={
            "payment_key": "phase-d-confirm-failure-key",
            "payment_group_id": str(confirm_order.payment_group_id),
            "amount": 15000,
        },
        headers=auth_headers(customer, settings),
    )
    assert confirm.status_code == 502
    assert confirm.json()["code"] == "payment_reconciliation_required"
    monkeypatch.setattr(payment_service, "_confirm", original_confirm)

    confirm_incident = await db_session.scalar(
        select(PaymentIncident).where(
            PaymentIncident.order_id == confirm_order.id,
            PaymentIncident.incident_type == "confirm",
            PaymentIncident.status == "open",
        )
    )
    assert confirm_incident is not None
    assert confirm_incident.expected_amount == 15000
    assert confirm_incident.details["lookup_payment_key"] == "phase-d-confirm-failure-key"
    await db_session.refresh(confirm_order)
    assert confirm_order.status == "결제중"
    assert confirm_order.payment_key == "phase-d-confirm-failure-key"

    blind_retry = await client.post(
        "/payments/confirm",
        json={
            "payment_key": "phase-d-confirm-failure-key",
            "payment_group_id": str(confirm_order.payment_group_id),
            "amount": 15000,
        },
        headers=auth_headers(customer, settings),
    )
    assert blind_retry.status_code == 409
    assert blind_retry.json()["code"] == "payment_reconciliation_required"
    assert toss.confirm_calls == 1

    refund_claim = await make_token_refund_claim(db_session, customer)
    refund_order = await db_session.get(Order, refund_claim.order_id)
    assert refund_order is not None
    refund_order.payment_key = "phase-d-refund-timeout-key"
    db_session.add(
        DesignToken(
            user_id=customer.id,
            amount=100,
            type="purchase",
            token_class="paid",
            work_id=f"order_{refund_order.id}",
            source_order_id=refund_order.id,
            expires_at=datetime.now(UTC) + timedelta(days=365),
        )
    )
    await db_session.commit()
    toss.cancel_exception = TimeoutError("provider timeout")

    async def assert_refund_operation_is_durable() -> None:
        async with app.state.sessionmaker() as verification:
            prepared = await verification.scalar(
                select(PaymentIncident).where(
                    PaymentIncident.claim_id == refund_claim.id,
                    PaymentIncident.incident_type == "refund",
                    PaymentIncident.status == "open",
                )
            )
            assert prepared is not None
            assert prepared.details["phase"] == "provider_call_pending"

    toss.before_cancel = assert_refund_operation_is_durable

    manager_forbidden = await client.post(
        f"/admin/token-refunds/{refund_claim.id}/approve",
        headers=auth_headers(manager, settings),
    )
    assert manager_forbidden.status_code == 403
    assert toss.cancel_calls == 0

    refund = await client.post(
        f"/admin/token-refunds/{refund_claim.id}/approve",
        headers=auth_headers(admin, settings),
    )
    assert refund.status_code == 502
    assert refund.json()["code"] == "payment_outcome_unknown"
    refund_incident = await db_session.scalar(
        select(PaymentIncident).where(
            PaymentIncident.claim_id == refund_claim.id,
            PaymentIncident.incident_type == "refund",
            PaymentIncident.status == "open",
        )
    )
    assert refund_incident is not None
    assert refund_incident.details["lookup_payment_key"] == "phase-d-refund-timeout-key"

    refund_blind_retry = await client.post(
        f"/admin/token-refunds/{refund_claim.id}/approve",
        headers=auth_headers(admin, settings),
    )
    assert refund_blind_retry.status_code == 409
    assert refund_blind_retry.json()["code"] == "payment_reconciliation_required"
    assert toss.cancel_calls == 1

    toss.cancel_exception = None
    toss.lookups[refund_order.payment_key] = TossResult(
        ok=True,
        status=200,
        body={
            "paymentKey": refund_order.payment_key,
            "status": "CANCELED",
            "orderId": str(refund_order.payment_group_id),
            "totalAmount": refund_order.total_price,
            "balanceAmount": 0,
            "cancels": [{"cancelAmount": refund_order.total_price}],
        },
    )
    reconciled = await client.post(
        f"/admin/payment-incidents/{refund_incident.id}/reconcile",
        headers=auth_headers(admin, settings),
    )
    assert reconciled.status_code == 200, reconciled.text
    assert reconciled.json()["details"]["reconciliation"]["apply_result"] == "applied"
    await db_session.refresh(refund_claim)
    await db_session.refresh(refund_order)
    assert refund_claim.status == "완료"
    assert refund_order.status == "취소"
    outbox = await db_session.scalar(
        select(ClaimNotificationLog).where(ClaimNotificationLog.claim_id == refund_claim.id)
    )
    assert outbox is not None and outbox.delivery_status == "pending"

    app.state.toss = old_toss

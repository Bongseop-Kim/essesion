"""주문 상태 검증과 클레임 생성의 order advisory lock 순서."""

import uuid
from collections.abc import Awaitable, Callable
from typing import cast

import pytest
from api.domains.orders import service
from api.domains.orders.schemas import RepairNoTrackingRequest, RepairTrackingRequest
from api.errors import NotFoundError
from db.models.auth import User
from sqlalchemy.ext.asyncio import AsyncSession


class ReadGuardSession:
    def __init__(self) -> None:
        self.lock_key: str | None = None
        self.scalar_calls = 0

    async def scalar(self, _statement: object) -> None:
        assert self.lock_key is not None
        self.scalar_calls += 1
        return None


async def test_claim_guarded_order_mutations_lock_before_read(monkeypatch) -> None:
    order_id = uuid.uuid4()
    user = User(id=uuid.uuid4(), name="잠금 테스트", role="customer")

    async def record_lock(session: AsyncSession, key: str) -> None:
        cast(ReadGuardSession, session).lock_key = key

    monkeypatch.setattr(service, "advisory_xact_lock", record_lock)
    operations: tuple[Callable[[AsyncSession], Awaitable[object]], ...] = (
        lambda session: service.confirm_purchase(session, user, order_id),
        lambda session: service.submit_repair_tracking(
            session,
            user,
            order_id,
            RepairTrackingRequest(courier_company="cj", tracking_number="123"),
        ),
        lambda session: service.submit_repair_no_tracking(
            session, user, order_id, RepairNoTrackingRequest()
        ),
        lambda session: service.admin_update_status(session, user, order_id, "배송중", None, False),
        lambda session: service.admin_update_tracking(
            session,
            order_id,
            courier_company="cj",
            tracking_number="123",
            company_courier_company=None,
            company_tracking_number=None,
        ),
    )

    for operation in operations:
        guard = ReadGuardSession()
        with pytest.raises(NotFoundError):
            await operation(cast(AsyncSession, guard))
        assert guard.lock_key == f"order:{order_id}"
        assert guard.scalar_calls == 1

"""인가 403 매트릭스 레지스트리 — 도메인 구현 시 여기 케이스를 추가한다.

실행은 test_authz.py. 각 케이스마다 실DB에서: 익명 401 / 타인 403 / 소유자·관리자
는 인가 통과(401·403이 아님)를 일괄 검증한다. mock 금지(ARCHITECTURE §5).
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from db.models.auth import User
from sqlalchemy.ext.asyncio import AsyncSession

# (session, owner) -> (url, json_body | None)
MakeFn = Callable[[AsyncSession, User], Awaitable[tuple[str, dict | None]]]


@dataclass
class OwnerCase:
    """owner-only 리소스 엔드포인트."""

    name: str
    method: str
    make: MakeFn


@dataclass
class AdminCase:
    """admin/manager 전용 엔드포인트 — customer 403, 익명 401."""

    name: str
    method: str
    url: str
    body: dict | None = field(default=None)


async def _order_detail(session: AsyncSession, owner: User) -> tuple[str, dict | None]:
    from .factories import make_order

    order = await make_order(session, owner)
    return f"/orders/{order.id}", None


async def _order_confirm_purchase(session: AsyncSession, owner: User) -> tuple[str, dict | None]:
    from .factories import make_order

    order = await make_order(session, owner, status="배송완료")
    return f"/orders/{order.id}/confirm-purchase", None


async def _token_refund_cancel(session: AsyncSession, owner: User) -> tuple[str, dict | None]:
    from .factories import make_token_refund_claim

    claim = await make_token_refund_claim(session, owner)
    return f"/tokens/refund-requests/{claim.id}/cancel", None


OWNER_CASES: list[OwnerCase] = [
    OwnerCase("orders_detail", "GET", _order_detail),
    OwnerCase("orders_confirm_purchase", "POST", _order_confirm_purchase),
    OwnerCase("token_refund_cancel", "POST", _token_refund_cancel),
]

ADMIN_CASES: list[AdminCase] = [
    AdminCase(
        "admin_tokens_manage",
        "POST",
        "/admin/tokens/manage",
        {"user_id": "00000000-0000-0000-0000-000000000000", "amount": 1, "description": "t"},
    ),
    AdminCase(
        "admin_products_create",
        "POST",
        "/admin/products",
        {
            "name": "t",
            "price": 1000,
            "image": "https://img.test/i.png",
            "category": "3fold",
            "color": "navy",
            "pattern": "solid",
            "material": "silk",
            "info": "t",
        },
    ),
]

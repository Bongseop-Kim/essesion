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


async def _quote_detail(session: AsyncSession, owner: User) -> tuple[str, dict | None]:
    from db.models.commerce import QuoteRequest, ShippingAddress

    address = ShippingAddress(
        user_id=owner.id,
        recipient_name="r",
        recipient_phone="01011112222",
        postal_code="1",
        address="a",
        is_default=True,
    )
    session.add(address)
    await session.flush()
    quote = QuoteRequest(
        user_id=owner.id,
        quote_number=f"QUO-TEST-{owner.id.hex[:6]}",
        shipping_address_id=address.id,
        options={},
        quantity=100,
        contact_name="c",
        contact_method="phone",
        contact_value="01011112222",
    )
    session.add(quote)
    await session.commit()
    return f"/quotes/{quote.id}", None


async def _inquiry_detail(session: AsyncSession, owner: User) -> tuple[str, dict | None]:
    from db.models.commerce import Inquiry

    inquiry = Inquiry(user_id=owner.id, title="문의", content="내용")
    session.add(inquiry)
    await session.commit()
    return f"/inquiries/{inquiry.id}", None


async def _inquiry_update(session: AsyncSession, owner: User) -> tuple[str, dict | None]:
    url, _ = await _inquiry_detail(session, owner)
    return url, {"title": "수정한 문의"}


async def _inquiry_delete(session: AsyncSession, owner: User) -> tuple[str, dict | None]:
    return await _inquiry_detail(session, owner)


async def _design_session_detail(session: AsyncSession, owner: User) -> tuple[str, dict | None]:
    from db.models.design import DesignSession

    design_session = DesignSession(user_id=owner.id)
    session.add(design_session)
    await session.commit()
    return f"/design/sessions/{design_session.id}", None


async def _claim_delete(session: AsyncSession, owner: User) -> tuple[str, dict | None]:
    from db.models.commerce import Claim, OrderItem

    from .factories import make_order

    order = await make_order(session, owner, status="배송완료")
    item = OrderItem(
        order_id=order.id,
        item_id=f"itm-{order.id}",
        item_type="product",
        quantity=1,
        unit_price=order.total_price,
    )
    session.add(item)
    await session.flush()
    claim = Claim(
        user_id=owner.id,
        order_id=order.id,
        order_item_id=item.id,
        claim_number=f"CLM-TEST-{owner.id.hex[:6]}",
        type="return",
        status="접수",
        reason="단순 변심",
        quantity=1,
    )
    session.add(claim)
    await session.commit()
    return f"/claims/{claim.id}", None


async def _design_motif_candidates(session: AsyncSession, owner: User) -> tuple[str, dict | None]:
    from db.models.design import DesignSession

    design_session = DesignSession(user_id=owner.id)
    session.add(design_session)
    await session.commit()
    return (
        f"/design/sessions/{design_session.id}/motifs/candidates",
        {"spec": {"subject": "flower", "scope": "whole"}},
    )


async def _design_motif_generate(session: AsyncSession, owner: User) -> tuple[str, dict | None]:
    from db.models.design import DesignSession

    design_session = DesignSession(user_id=owner.id)
    session.add(design_session)
    await session.commit()
    return (
        f"/design/sessions/{design_session.id}/motifs/generate",
        {"spec": {"subject": "flower", "scope": "whole"}},
    )


async def _design_job_detail(session: AsyncSession, owner: User) -> tuple[str, dict | None]:
    from db.models.design import DesignSession, GenerationJob

    design_session = DesignSession(user_id=owner.id)
    session.add(design_session)
    await session.flush()
    job = GenerationJob(
        user_id=owner.id,
        session_id=design_session.id,
        kind="finalize",
        params={},
    )
    session.add(job)
    await session.commit()
    return f"/design/jobs/{job.id}", None


async def _address_delete(session: AsyncSession, owner: User) -> tuple[str, dict | None]:
    from db.models.commerce import ShippingAddress

    address = ShippingAddress(
        user_id=owner.id,
        recipient_name="r",
        recipient_phone="01011112222",
        postal_code="1",
        address="a",
        is_default=False,
    )
    session.add(address)
    await session.commit()
    return f"/users/me/addresses/{address.id}", None


OWNER_CASES: list[OwnerCase] = [
    OwnerCase("orders_detail", "GET", _order_detail),
    OwnerCase("orders_confirm_purchase", "POST", _order_confirm_purchase),
    OwnerCase("token_refund_cancel", "POST", _token_refund_cancel),
    OwnerCase("claims_delete", "DELETE", _claim_delete),
    OwnerCase("quotes_detail", "GET", _quote_detail),
    OwnerCase("inquiries_detail", "GET", _inquiry_detail),
    OwnerCase("inquiries_update", "PATCH", _inquiry_update),
    OwnerCase("inquiries_delete", "DELETE", _inquiry_delete),
    OwnerCase("design_session_detail", "GET", _design_session_detail),
    OwnerCase("design_job_detail", "GET", _design_job_detail),
    OwnerCase("design_motif_candidates", "POST", _design_motif_candidates),
    OwnerCase("design_motif_generate", "POST", _design_motif_generate),
    OwnerCase("address_delete", "DELETE", _address_delete),
]

ADMIN_CASES: list[AdminCase] = [
    AdminCase(
        "admin_tokens_manage",
        "POST",
        "/admin/tokens/manage",
        {
            "operation_id": "00000000-0000-0000-0000-000000000001",
            "user_id": "00000000-0000-0000-0000-000000000000",
            "amount": 1,
            "description": "권한 확인",
        },
    ),
    AdminCase(
        "admin_products_create",
        "POST",
        "/admin/products",
        {
            "name": "t",
            "price": 1000,
            "image_upload_id": "00000000-0000-0000-0000-000000000000",
            "category": "3fold",
            "color": "navy",
            "pattern": "solid",
            "material": "silk",
            "info": "t",
        },
    ),
    AdminCase("admin_claims_list", "GET", "/admin/claims"),
    AdminCase("admin_quotes_list", "GET", "/admin/quotes"),
    AdminCase("admin_stats_today", "GET", "/admin/stats/today?stat_date=2026-01-01"),
    AdminCase("admin_capabilities", "GET", "/admin/capabilities"),
    AdminCase("admin_inquiries_list", "GET", "/admin/inquiries"),
    AdminCase("admin_coupons_list", "GET", "/admin/coupons"),
    AdminCase("admin_manual_orders_list", "GET", "/admin/manual-orders"),
    AdminCase(
        "admin_manual_orders_create",
        "POST",
        "/admin/manual-orders",
        {
            "order_date": "2026-01-01",
            "customer_name": "t",
            "phone": "01011112222",
            "amount": 1000,
            "items": [{"quantity": 1, "width": {"target_width_cm": 8}}],
        },
    ),
    # 404여도 인가 통과(401·403 아님)로 판정되므로 더미 UUID로 충분
    AdminCase(
        "admin_orders_status",
        "POST",
        "/admin/orders/00000000-0000-0000-0000-000000000000/status",
        {"new_status": "배송중"},
    ),
    AdminCase(
        "admin_token_refund_approve",
        "POST",
        "/admin/token-refunds/00000000-0000-0000-0000-000000000000/approve",
    ),
]

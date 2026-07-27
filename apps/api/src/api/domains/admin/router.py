"""관리자 — 쿠폰 관리·통계·고객/주문 목록 (domains.md §10)."""

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel

from api.db import SessionDep
from api.deps import AdminUser
from api.domains.admin import orders as order_queries
from api.domains.admin.quote_schemas import SignedReadUrlOut
from api.domains.admin.schemas import (
    AdminOrderDetailOut,
    AdminOrderReferenceImageOut,
    AdminOrderSummaryOut,
    DashboardRecentOrdersPage,
    DashboardRecentQuotesPage,
    DashboardSummaryOut,
    DashboardTimeseriesOut,
    DashboardTopProductsOut,
    OrderSort,
    OrderStatusFilter,
    OrderTypeFilter,
    Page,
    SortDirection,
)

router = APIRouter(prefix="/admin", tags=["admin"])


class AdminCapabilitiesOut(BaseModel):
    toss: str
    gcs: str
    gcs_assets: str
    solapi: str
    worker: str
    finalize_tasks: str
    batch_auth: str
    oauth_google: str
    oauth_kakao: str
    oauth_naver: str
    oauth_apple: str
    auth_secrets: str
    edge_proxy: str


@router.get("/capabilities", response_model=AdminCapabilitiesOut)
async def get_admin_capabilities(request: Request, admin: AdminUser) -> AdminCapabilitiesOut:
    return AdminCapabilitiesOut.model_validate(request.app.state.capabilities)


@router.get("/dashboard/summary", response_model=DashboardSummaryOut)
async def get_dashboard_summary(
    session: SessionDep,
    admin: AdminUser,
    start_date: date | None = None,
    end_date: date | None = None,
    order_type: OrderTypeFilter = "all",
) -> DashboardSummaryOut:
    return await order_queries.dashboard_summary(
        session,
        start_date=start_date,
        end_date=end_date,
        order_type=order_type,
    )


@router.get("/dashboard/timeseries", response_model=DashboardTimeseriesOut)
async def get_dashboard_timeseries(
    session: SessionDep,
    admin: AdminUser,
    start_date: date | None = None,
    end_date: date | None = None,
    order_type: OrderTypeFilter = "all",
) -> DashboardTimeseriesOut:
    return await order_queries.dashboard_timeseries(
        session,
        start_date=start_date,
        end_date=end_date,
        order_type=order_type,
    )


@router.get("/dashboard/top-products", response_model=DashboardTopProductsOut)
async def get_dashboard_top_products(
    session: SessionDep,
    admin: AdminUser,
    start_date: date | None = None,
    end_date: date | None = None,
    limit: Annotated[
        int, Query(ge=1, le=order_queries.MAX_TOP_PRODUCT_LIMIT)
    ] = order_queries.DEFAULT_TOP_PRODUCT_LIMIT,
) -> DashboardTopProductsOut:
    return await order_queries.dashboard_top_products(
        session,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
    )


@router.get("/dashboard/recent-orders", response_model=DashboardRecentOrdersPage)
async def get_dashboard_recent_orders(
    session: SessionDep,
    admin: AdminUser,
    order_type: OrderTypeFilter = "all",
    limit: Annotated[
        int, Query(ge=1, le=order_queries.MAX_RECENT_LIMIT)
    ] = order_queries.DEFAULT_RECENT_LIMIT,
) -> DashboardRecentOrdersPage:
    return await order_queries.recent_orders(session, order_type=order_type, limit=limit)


@router.get("/dashboard/recent-quotes", response_model=DashboardRecentQuotesPage)
async def get_dashboard_recent_quotes(
    session: SessionDep,
    admin: AdminUser,
    limit: Annotated[
        int, Query(ge=1, le=order_queries.MAX_RECENT_LIMIT)
    ] = order_queries.DEFAULT_RECENT_LIMIT,
) -> DashboardRecentQuotesPage:
    return await order_queries.recent_quotes(session, limit=limit)


@router.get("/orders", response_model=Page[AdminOrderSummaryOut])
async def list_all_orders(
    session: SessionDep,
    admin: AdminUser,
    order_type: OrderTypeFilter = "all",
    status: OrderStatusFilter = "all",
    start_date: date | None = None,
    end_date: date | None = None,
    q: Annotated[str | None, Query(max_length=64)] = None,
    sort: OrderSort = "created_at",
    direction: SortDirection = "desc",
    limit: Annotated[
        int, Query(ge=1, le=order_queries.MAX_PAGE_LIMIT)
    ] = order_queries.DEFAULT_PAGE_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[AdminOrderSummaryOut]:
    return await order_queries.list_orders(
        session,
        order_type=order_type,
        status=status,
        start_date=start_date,
        end_date=end_date,
        q=q,
        sort=sort,
        direction=direction,
        limit=limit,
        offset=offset,
    )


@router.get("/orders/{order_id}", response_model=AdminOrderDetailOut)
async def get_admin_order(
    order_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> AdminOrderDetailOut:
    return await order_queries.get_order_detail(session, order_id)


@router.get(
    "/orders/{order_id}/reference-images",
    response_model=list[AdminOrderReferenceImageOut],
)
async def list_admin_order_reference_images(
    order_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> list[AdminOrderReferenceImageOut]:
    return await order_queries.list_order_reference_images(session, order_id)


@router.post(
    "/orders/{order_id}/reference-images/{image_id}/read-url",
    response_model=SignedReadUrlOut,
)
async def create_admin_order_reference_image_read_url(
    order_id: uuid.UUID,
    image_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
    request: Request,
) -> SignedReadUrlOut:
    image = await order_queries.get_order_reference_image(session, order_id, image_id)
    return SignedReadUrlOut(read_url=await request.app.state.gcs.signed_read_url(image.object_key))

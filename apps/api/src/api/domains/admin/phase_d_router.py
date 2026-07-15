import uuid
from datetime import date
from typing import Annotated

from db.models.commerce import ClaimNotificationLog
from fastapi import APIRouter, Query, Request
from obs import request_id_var

from api.db import SessionDep
from api.deps import AdminOnly, AdminUser
from api.domains.admin import claim_operations, payment_incidents
from api.domains.admin.phase_d_schemas import (
    AdminClaimDetailOut,
    AdminClaimSummaryOut,
    ClaimNotificationOut,
    ClaimSort,
    ClaimStatusFilter,
    ClaimTrackingUpdateRequest,
    ClaimTypeFilter,
    IncidentResolveRequest,
    IncidentSort,
    IncidentStatusFilter,
    IncidentTypeFilter,
    PaymentIncidentDetailOut,
    PaymentIncidentSummaryOut,
)
from api.domains.admin.schemas import Page
from api.domains.admin.types import SortDirection
from api.domains.claims.service import deliver_notification

router = APIRouter(prefix="/admin", tags=["admin-operations"])


@router.get("/claims", response_model=Page[AdminClaimSummaryOut])
async def admin_list_claims_v2(
    session: SessionDep,
    admin: AdminUser,
    claim_type: ClaimTypeFilter = "all",
    status: ClaimStatusFilter = "all",
    start_date: date | None = None,
    end_date: date | None = None,
    q: Annotated[str | None, Query(max_length=64)] = None,
    sort: ClaimSort = "created_at",
    direction: SortDirection = "desc",
    limit: Annotated[
        int, Query(ge=1, le=claim_operations.MAX_PAGE_LIMIT)
    ] = claim_operations.DEFAULT_PAGE_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[AdminClaimSummaryOut]:
    return await claim_operations.list_claims(
        session,
        actor_role=admin.role,
        claim_type=claim_type,
        status=status,
        start_date=start_date,
        end_date=end_date,
        q=q,
        sort=sort,
        direction=direction,
        limit=limit,
        offset=offset,
    )


@router.get("/claims/{claim_id}", response_model=AdminClaimDetailOut)
async def admin_get_claim(
    claim_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> AdminClaimDetailOut:
    return await claim_operations.get_claim_detail(session, claim_id, actor_role=admin.role)


@router.patch("/claims/{claim_id}/tracking", response_model=AdminClaimDetailOut)
async def admin_update_claim_tracking(
    claim_id: uuid.UUID,
    body: ClaimTrackingUpdateRequest,
    session: SessionDep,
    admin: AdminUser,
) -> AdminClaimDetailOut:
    await claim_operations.update_claim_tracking(
        session,
        claim_id,
        body,
        actor_id=admin.id,
        request_id=request_id_var.get(),
    )
    return await claim_operations.get_claim_detail(session, claim_id, actor_role=admin.role)


@router.post(
    "/claim-notifications/{notification_id}/retry",
    response_model=ClaimNotificationOut,
)
async def admin_retry_claim_notification(
    notification_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
    request: Request,
) -> ClaimNotificationOut:
    await deliver_notification(
        session,
        request.app.state.solapi,
        request.app.state.settings,
        notification_id,
    )
    notification = await session.get(ClaimNotificationLog, notification_id)
    assert notification is not None
    return ClaimNotificationOut.model_validate(notification)


@router.get("/payment-incidents", response_model=Page[PaymentIncidentSummaryOut])
async def admin_list_payment_incidents(
    session: SessionDep,
    admin: AdminUser,
    incident_type: IncidentTypeFilter = "all",
    status: IncidentStatusFilter = "open",
    start_date: date | None = None,
    end_date: date | None = None,
    q: Annotated[str | None, Query(min_length=2, max_length=128)] = None,
    sort: IncidentSort = "created_at",
    direction: SortDirection = "desc",
    limit: Annotated[
        int, Query(ge=1, le=payment_incidents.MAX_PAGE_LIMIT)
    ] = payment_incidents.DEFAULT_PAGE_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[PaymentIncidentSummaryOut]:
    return await payment_incidents.list_incidents(
        session,
        incident_type=incident_type,
        status=status,
        start_date=start_date,
        end_date=end_date,
        q=q,
        sort=sort,
        direction=direction,
        limit=limit,
        offset=offset,
    )


@router.get("/payment-incidents/{incident_id}", response_model=PaymentIncidentDetailOut)
async def admin_get_payment_incident(
    incident_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> PaymentIncidentDetailOut:
    return await payment_incidents.get_incident_detail(session, incident_id, actor_role=admin.role)


@router.post(
    "/payment-incidents/{incident_id}/reconcile",
    response_model=PaymentIncidentDetailOut,
)
async def admin_reconcile_payment_incident(
    incident_id: uuid.UUID,
    session: SessionDep,
    admin: AdminOnly,
    request: Request,
) -> PaymentIncidentDetailOut:
    await payment_incidents.reconcile_incident(
        session,
        request.app.state.toss,
        incident_id,
        actor_id=admin.id,
    )
    return await payment_incidents.get_incident_detail(session, incident_id, actor_role=admin.role)


@router.post(
    "/payment-incidents/{incident_id}/resolve",
    response_model=PaymentIncidentDetailOut,
)
async def admin_resolve_payment_incident(
    incident_id: uuid.UUID,
    body: IncidentResolveRequest,
    session: SessionDep,
    admin: AdminOnly,
) -> PaymentIncidentDetailOut:
    await payment_incidents.resolve_incident(
        session,
        incident_id=incident_id,
        actor_id=admin.id,
        operation_id=body.operation_id,
        memo=body.memo,
        request_id=request_id_var.get(),
    )
    return await payment_incidents.get_incident_detail(session, incident_id, actor_role=admin.role)

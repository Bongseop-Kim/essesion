"""수기 주문 — 무통장·전화 접수 종이 작업지시서 CRUD. 기존 주문 상태머신과 무관."""

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal

from db.models.commerce import ManualOrder
from db.models.images import Image
from fastapi import APIRouter, Query, Request
from pydantic import AwareDatetime, BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, or_, select

from api.db import SessionDep
from api.deps import AdminUser
from api.domains.admin.quote_schemas import SignedReadUrlOut
from api.domains.admin.schemas import Page
from api.domains.images.service import (
    ALLOWED_ORDER_IMAGE_TYPES,
    MAX_ORDER_IMAGE_BYTES,
    verify_object_metadata,
)
from api.domains.reform.schemas import RestorationReform, WidthReform
from api.errors import ConflictError, DomainError, NotFoundError
from api.phone_numbers import normalize_mobile_phone
from api.schemas import StrictModel

router = APIRouter(prefix="/admin/manual-orders", tags=["admin-manual-orders"])
DEFAULT_LIMIT = 20
MAX_LIMIT = 100

# 첨부 사진은 고객 사진이라 공개 assets 버킷을 쓰지 않는다 — 비공개 uploads 버킷 + 서명 읽기 URL.
IMAGE_UPLOAD_TYPE = "manual_order_upload"
IMAGE_LINKED_TYPE = "manual_order"
IMAGE_PREFIX = f"uploads/{IMAGE_UPLOAD_TYPE}/"
IMAGE_UPLOAD_TTL = timedelta(hours=24)
IMAGE_EXTENSIONS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_IMAGES = 5


class ManualAutomaticSpec(StrictModel):
    """자동수선 — 종이 양식의 총장(cm)을 받는다(reform의 wearer_height_cm와 다름)."""

    mechanism: Literal["zipper", "string"]
    turn_knot: bool = False  # 마감: False=방, True=돌려묶기
    dimple: bool = False  # False=기본, True=딤플
    total_length_cm: float = Field(gt=0)

    @model_validator(mode="after")
    def validate_turn_knot(self) -> "ManualAutomaticSpec":
        if self.mechanism == "string" and self.turn_knot:
            raise ValueError("끈 방식에서는 돌려묶기를 선택할 수 없습니다")
        return self


class ManualCustomSpec(StrictModel):
    """주문제작 — 종이 양식의 핵심 항목만(원단·봉제·규격·타이 폭·메모).

    키 이름·값은 store 맞춤 주문 options 어휘(fabric_provided, design_type,
    fabric_type, tie_type, size_type)를 따른다. 수량은 품목 공통 quantity를 쓴다.
    """

    fabric_provided: bool = False  # True=고객 원단 제공
    fabric_type: Literal["POLY", "SILK"] | None = None
    design_type: Literal["PRINTING", "YARN_DYED"] | None = None
    tie_type: Literal["MANUAL", "AUTO"] = "MANUAL"
    dimple: bool = False  # AUTO 전용
    turn_knot: bool = False  # AUTO 전용
    size_type: Literal["ADULT", "CHILD"] = "ADULT"
    tie_width_cm: float | None = Field(default=None, gt=0)
    memo: str = Field(default="", max_length=200)

    @field_validator("memo")
    @classmethod
    def strip_memo(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def validate_spec(self) -> "ManualCustomSpec":
        if self.fabric_provided:
            # 원단 제공이면 원단 선택은 무의미 — 저장분 재검증(_out)이 통과하도록 정규화
            self.fabric_type = None
            self.design_type = None
        elif self.fabric_type is None or self.design_type is None:
            raise ValueError("원단 제공이 아니면 원단·디자인 방식을 선택해주세요")
        if self.tie_type != "AUTO" and (self.dimple or self.turn_knot):
            raise ValueError("딤플·돌려묶기는 자동 봉제에서만 선택할 수 있습니다")
        return self


class ManualOrderItem(StrictModel):
    """품목 — automatic/width/restoration/custom 존재 여부가 대분류 체크 상태."""

    quantity: int = Field(ge=1, le=999)
    automatic: ManualAutomaticSpec | None = None
    width: WidthReform | None = None
    restoration: RestorationReform | None = None
    custom: ManualCustomSpec | None = None
    note: str = Field(default="", max_length=500)  # 특이사항
    # 품목별 첨부 사진(주문제작 시안 등). 링크는 주문 단위와 같고, 어느 품목 것인지만 여기 남는다.
    image_upload_ids: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_IMAGES)

    @model_validator(mode="after")
    def validate_category_selected(self) -> "ManualOrderItem":
        if (
            self.automatic is None
            and self.width is None
            and self.restoration is None
            and self.custom is None
        ):
            raise ValueError("대분류를 하나 이상 선택해주세요")
        return self


class ManualOrderCreateRequest(BaseModel):
    order_date: date
    customer_name: str = Field(min_length=1, max_length=100)
    phone: str = Field(min_length=1, max_length=20)
    address: str | None = Field(default=None, max_length=500)
    amount: int = Field(ge=0)  # 원금 — 할인 전 금액
    discount: int = Field(default=0, ge=0)
    shipping_fee: int = Field(default=0, ge=0)
    is_received: bool = False
    is_paid: bool = False
    is_confirmed: bool = False
    items: list[ManualOrderItem] = Field(min_length=1, max_length=50)
    # 수정 요청도 남길 이미지 전체 목록을 보낸다(빠진 id는 만료 처리).
    image_upload_ids: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_IMAGES)

    @model_validator(mode="after")
    def reject_reused_images(self) -> "ManualOrderCreateRequest":
        """한 이미지는 주문 단위든 품목이든 한 곳에만 붙는다 — 만료 판단이 갈린다."""
        if len(set(self.all_image_upload_ids)) != len(self.all_image_upload_ids):
            raise ValueError("첨부 이미지가 중복되었습니다")
        return self

    @property
    def all_image_upload_ids(self) -> list[uuid.UUID]:
        return [
            *self.image_upload_ids,
            *(image_id for item in self.items for image_id in item.image_upload_ids),
        ]

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, value: str) -> str:
        return normalize_mobile_phone(value)

    @model_validator(mode="after")
    def validate_discount(self) -> "ManualOrderCreateRequest":
        if self.discount > self.amount:
            raise ValueError("할인은 금액을 넘을 수 없습니다")
        return self


class ManualOrderUpdateRequest(ManualOrderCreateRequest):
    expected_updated_at: AwareDatetime


class ManualOrderImageOut(BaseModel):
    id: uuid.UUID
    content_type: str | None
    size_bytes: int | None
    created_at: datetime


class ManualOrderImageUploadRequest(BaseModel):
    content_type: str
    size_bytes: int = Field(gt=0, le=MAX_ORDER_IMAGE_BYTES)


class ManualOrderImageUploadOut(BaseModel):
    upload_id: uuid.UUID
    upload_url: str
    required_headers: dict[str, str]
    expires_at: datetime


class ManualOrderOut(BaseModel):
    id: uuid.UUID
    order_date: date
    customer_name: str
    phone: str
    address: str | None
    amount: int
    discount: int
    shipping_fee: int
    is_received: bool
    is_paid: bool
    is_confirmed: bool
    items: list[ManualOrderItem]
    images: list[ManualOrderImageOut]
    created_at: datetime
    updated_at: datetime


def _out(row: ManualOrder, images: list[Image]) -> ManualOrderOut:
    return ManualOrderOut(
        id=row.id,
        order_date=row.order_date,
        customer_name=row.customer_name,
        phone=row.phone,
        address=row.address,
        amount=row.amount,
        discount=row.discount,
        shipping_fee=row.shipping_fee,
        is_received=row.is_received,
        is_paid=row.is_paid,
        is_confirmed=row.is_confirmed,
        items=[ManualOrderItem.model_validate(item) for item in row.items],
        images=[
            ManualOrderImageOut(
                id=image.id,
                content_type=image.content_type,
                size_bytes=image.size_bytes,
                created_at=image.created_at,
            )
            for image in images
        ],
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def _manual_order_or_404(
    session, manual_order_id: uuid.UUID, *, lock: bool = False
) -> ManualOrder:
    query = select(ManualOrder).where(ManualOrder.id == manual_order_id)
    if lock:
        query = query.with_for_update()
    row = await session.scalar(query)
    if row is None:
        raise NotFoundError("수기 주문을 찾을 수 없습니다")
    return row


def _apply_body(row: ManualOrder, body: ManualOrderCreateRequest) -> None:
    values = body.model_dump(exclude={"expected_updated_at", "items", "image_upload_ids"})
    for key, value in values.items():
        setattr(row, key, value)
    row.items = [item.model_dump(mode="json") for item in body.items]


def _live_images(*order_ids: uuid.UUID):
    now = datetime.now(UTC)
    return (
        select(Image)
        .where(
            Image.entity_type == IMAGE_LINKED_TYPE,
            Image.entity_id.in_([str(order_id) for order_id in order_ids]),
            Image.deleted_at.is_(None),
            or_(Image.expires_at.is_(None), Image.expires_at > now),
        )
        .order_by(Image.created_at, Image.id)
    )


async def _images_of(session, manual_order_id: uuid.UUID) -> list[Image]:
    return list(await session.scalars(_live_images(manual_order_id)))


async def _sync_images(
    session, row: ManualOrder, upload_ids: list[uuid.UUID], admin, gcs
) -> list[Image]:
    """요청 목록을 이 주문의 첨부 이미지 전체로 만든다 — 빠진 기존 이미지는 만료시킨다."""
    linked = {image.id: image for image in await _images_of(session, row.id)}
    requested: list[Image] = []
    for upload_id in upload_ids:
        if upload_id in linked:  # 이미 이 주문에 링크된 이미지 — 다른 관리자가 올렸어도 유지
            requested.append(linked[upload_id])
            continue
        image = await session.scalar(select(Image).where(Image.id == upload_id).with_for_update())
        if (
            image is None
            or image.entity_type != IMAGE_UPLOAD_TYPE
            or image.uploaded_by != admin.id
            or image.deleted_at is not None
            or image.content_type not in ALLOWED_ORDER_IMAGE_TYPES
        ):
            raise DomainError("유효하지 않은 첨부 이미지입니다", code="invalid_manual_order_image")
        await verify_object_metadata(image, gcs)
        image.entity_type = IMAGE_LINKED_TYPE
        image.entity_id = str(row.id)
        image.expires_at = None
        requested.append(image)

    keep = {image.id for image in requested}
    _expire(image for image in linked.values() if image.id not in keep)
    return requested


def _expire(images) -> None:
    """정리는 기존 cleanup-images 배치가 expires_at 기준으로 처리한다."""
    now = datetime.now(UTC)
    for image in images:
        image.expires_at = now


@router.get("", response_model=Page[ManualOrderOut])
async def list_manual_orders(
    session: SessionDep,
    admin: AdminUser,
    q: Annotated[str | None, Query(max_length=64)] = None,
    start_date: date | None = None,
    end_date: date | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[ManualOrderOut]:
    query = select(ManualOrder)
    if q:
        pattern = f"%{q.strip()}%"
        query = query.where(
            or_(ManualOrder.customer_name.ilike(pattern), ManualOrder.phone.ilike(pattern))
        )
    if start_date is not None:
        query = query.where(ManualOrder.order_date >= start_date)
    if end_date is not None:
        query = query.where(ManualOrder.order_date <= end_date)
    total = int(await session.scalar(select(func.count()).select_from(query.subquery())) or 0)
    rows = list(
        await session.scalars(
            query.order_by(ManualOrder.order_date.desc(), ManualOrder.id.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    images: dict[str, list[Image]] = {}
    if rows:
        for image in await session.scalars(_live_images(*[row.id for row in rows])):
            images.setdefault(image.entity_id, []).append(image)
    return Page(
        items=[_out(row, images.get(str(row.id), [])) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=ManualOrderOut, status_code=201)
async def create_manual_order(
    body: ManualOrderCreateRequest, session: SessionDep, admin: AdminUser, request: Request
) -> ManualOrderOut:
    row = ManualOrder()
    _apply_body(row, body)
    session.add(row)
    await session.flush()
    images = await _sync_images(
        session, row, body.all_image_upload_ids, admin, request.app.state.gcs
    )
    await session.commit()
    await session.refresh(row)
    return _out(row, images)


@router.post("/images/upload-url", response_model=ManualOrderImageUploadOut)
async def create_manual_order_image_upload_url(
    body: ManualOrderImageUploadRequest,
    session: SessionDep,
    admin: AdminUser,
    request: Request,
) -> ManualOrderImageUploadOut:
    extension = IMAGE_EXTENSIONS.get(body.content_type)
    if extension is None:
        raise DomainError(
            "지원하지 않는 이미지 형식입니다", code="invalid_manual_order_image_type", status=422
        )
    object_key = f"{IMAGE_PREFIX}{uuid.uuid4().hex}{extension}"
    expires_at = datetime.now(UTC) + IMAGE_UPLOAD_TTL
    image = Image(
        object_key=object_key,
        entity_type=IMAGE_UPLOAD_TYPE,
        entity_id=object_key,
        uploaded_by=admin.id,
        content_type=body.content_type,
        size_bytes=body.size_bytes,
        expires_at=expires_at,
    )
    session.add(image)
    await session.flush()
    upload_url = await request.app.state.gcs.signed_upload_url(
        object_key,
        body.content_type,
        max_size_bytes=MAX_ORDER_IMAGE_BYTES,
        create_only=True,
    )
    await session.commit()
    return ManualOrderImageUploadOut(
        upload_id=image.id,
        upload_url=upload_url,
        required_headers={
            "Content-Type": body.content_type,
            "x-goog-content-length-range": f"1,{MAX_ORDER_IMAGE_BYTES}",
            "x-goog-if-generation-match": "0",
        },
        expires_at=expires_at,
    )


@router.get("/{manual_order_id}", response_model=ManualOrderOut)
async def get_manual_order(
    manual_order_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> ManualOrderOut:
    row = await _manual_order_or_404(session, manual_order_id)
    return _out(row, await _images_of(session, row.id))


@router.put("/{manual_order_id}", response_model=ManualOrderOut)
async def update_manual_order(
    manual_order_id: uuid.UUID,
    body: ManualOrderUpdateRequest,
    session: SessionDep,
    admin: AdminUser,
    request: Request,
) -> ManualOrderOut:
    row = await _manual_order_or_404(session, manual_order_id, lock=True)
    if row.updated_at != body.expected_updated_at:
        raise ConflictError("수기 주문이 다른 관리자에 의해 변경되었습니다", code="stale_resource")
    _apply_body(row, body)
    images = await _sync_images(
        session, row, body.all_image_upload_ids, admin, request.app.state.gcs
    )
    await session.commit()
    await session.refresh(row)
    return _out(row, images)


@router.delete("/{manual_order_id}", status_code=204)
async def delete_manual_order(
    manual_order_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> None:
    row = await _manual_order_or_404(session, manual_order_id)
    _expire(await _images_of(session, row.id))
    await session.delete(row)
    await session.commit()


@router.post("/{manual_order_id}/images/{image_id}/read-url", response_model=SignedReadUrlOut)
async def create_manual_order_image_read_url(
    manual_order_id: uuid.UUID,
    image_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
    request: Request,
) -> SignedReadUrlOut:
    image = await session.scalar(_live_images(manual_order_id).where(Image.id == image_id))
    if image is None:
        raise NotFoundError("첨부 이미지를 찾을 수 없습니다")
    return SignedReadUrlOut(read_url=await request.app.state.gcs.signed_read_url(image.object_key))

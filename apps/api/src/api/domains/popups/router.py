"""팝업 공지 — 공개 조회(활성 1건)와 admin CRUD·배너 이미지 업로드.

노출 판정은 서버가 KST 날짜로 한다 — 브라우저 시간대에 맡기면 해외 접속과 어긋난다.
이벤트 배너 이미지는 상품 이미지와 같은 경로(서명 URL → 공개 assets 버킷 → 완료 등록 →
저장 시 연결)를 복제한다. 추상화하지 않는다: 두 번째 복제일 뿐이고 상품 계약을 흔들지 않는다.
"""

import uuid
from collections.abc import Iterable
from datetime import UTC, date, datetime, timedelta
from pathlib import PurePosixPath
from typing import Any

from db.models.content import PopupNotice
from db.models.images import Image
from fastapi import APIRouter, Request
from sqlalchemy import or_, select

from api.config import Settings
from api.db import SessionDep
from api.deps import AdminUser
from api.domains.admin.helpers import KST
from api.errors import ConflictError, DomainError, NotFoundError
from api.integrations.gcs import assets_bucket_name, public_asset_url

from .schemas import (
    AdminPopupNoticeOut,
    PopupImageCompleteOut,
    PopupImageUploadOut,
    PopupImageUploadRequest,
    PopupNoticeCreateRequest,
    PopupNoticeOut,
    PopupNoticeUpdateRequest,
    validate_link,
    validate_period,
)

router = APIRouter(tags=["popups"])
admin_router = APIRouter(prefix="/admin/popups", tags=["admin-popups"])

IMAGE_UPLOAD_TYPE = "popup_upload"
IMAGE_LINKED_TYPE = "popup"
# 배치(`batch/router.py`)가 이 접두로 공개 assets 버킷 소속을 판정한다.
IMAGE_PREFIX = "popups/"
MAX_IMAGE_BYTES = 10 * 1024 * 1024
UPLOAD_TTL = timedelta(hours=24)
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


def _today_kst() -> date:
    return datetime.now(KST).date()


def _active_now(row: PopupNotice, today: date) -> bool:
    return row.enabled and row.starts_on <= today <= row.ends_on


def _clean(value: str | None) -> str | None:
    return (value or "").strip() or None


async def _linked_images(session: SessionDep, popup_ids: Iterable[uuid.UUID]) -> dict[str, Image]:
    ids = [str(popup_id) for popup_id in popup_ids]
    if not ids:
        return {}
    now = datetime.now(UTC)
    rows = await session.scalars(
        select(Image).where(
            Image.entity_type == IMAGE_LINKED_TYPE,
            Image.entity_id.in_(ids),
            Image.deleted_at.is_(None),
            or_(Image.expires_at.is_(None), Image.expires_at > now),
        )
    )
    return {image.entity_id: image for image in rows}


def _fields_out(
    row: PopupNotice, image: Image | None, settings: Settings, *, admin: bool
) -> dict[str, Any]:
    if row.template != "event":
        return dict(row.fields)
    # 이미지 행이 없으면(이론상 없음) 빈 URL — store의 ImageFrame이 실루엣 폴백을 그린다.
    out: dict[str, Any] = {
        "template": "event",
        "image_url": public_asset_url(settings, image.object_key) if image else "",
    }
    if admin:
        out["image_upload_id"] = image.id if image else row.fields["image_upload_id"]
    return out


def _public_out(row: PopupNotice, image: Image | None, settings: Settings) -> PopupNoticeOut:
    return PopupNoticeOut(
        id=row.id,
        template=row.template,  # type: ignore[arg-type]
        title=row.title,
        title_emphasis=row.title_emphasis,
        body=row.body,
        fields=_fields_out(row, image, settings, admin=False),  # type: ignore[arg-type]
        link_url=row.link_url,
    )


def _admin_out(
    row: PopupNotice, image: Image | None, settings: Settings, today: date
) -> AdminPopupNoticeOut:
    return AdminPopupNoticeOut(
        id=row.id,
        template=row.template,  # type: ignore[arg-type]
        title=row.title,
        title_emphasis=row.title_emphasis,
        body=row.body,
        fields=_fields_out(row, image, settings, admin=True),  # type: ignore[arg-type]
        link_url=row.link_url,
        starts_on=row.starts_on,
        ends_on=row.ends_on,
        enabled=row.enabled,
        active_now=_active_now(row, today),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/popups/active", response_model=PopupNoticeOut | None)
async def get_active_popup(session: SessionDep, request: Request) -> PopupNoticeOut | None:
    """store 첫 진입 팝업 — 활성이고 KST 오늘이 기간 안인 것 중 1건. 없으면 null."""
    today = _today_kst()
    row = await session.scalar(
        select(PopupNotice)
        .where(
            PopupNotice.enabled.is_(True),
            PopupNotice.starts_on <= today,
            PopupNotice.ends_on >= today,
        )
        .order_by(PopupNotice.starts_on.desc(), PopupNotice.created_at.desc())
        .limit(1)
    )
    if row is None:
        return None
    image = (await _linked_images(session, [row.id])).get(str(row.id))
    return _public_out(row, image, request.app.state.settings)


# ── admin CRUD ──


async def _popup_or_404(session: SessionDep, popup_id: uuid.UUID) -> PopupNotice:
    row = await session.get(PopupNotice, popup_id)
    if row is None:
        raise NotFoundError("팝업 공지를 찾을 수 없습니다")
    return row


def _expire(image: Image | None) -> None:
    """정리는 기존 cleanup-images 배치가 expires_at 기준으로 처리한다."""
    if image is not None:
        image.expires_at = datetime.now(UTC)


async def _link_image(
    session: SessionDep, row: PopupNotice, upload_id: uuid.UUID, admin_id: uuid.UUID
) -> Image:
    """완료된 스테이징 이미지를 이 팝업에 연결한다. 교체되는 이전 이미지는 만료시킨다."""
    current = (await _linked_images(session, [row.id])).get(str(row.id))
    if current is not None and current.id == upload_id:
        return current
    image = await session.scalar(select(Image).where(Image.id == upload_id).with_for_update())
    now = datetime.now(UTC)
    if (
        image is None
        or image.entity_type != IMAGE_UPLOAD_TYPE
        or image.uploaded_by != admin_id
        or image.deleted_at is not None
        or (image.expires_at is not None and image.expires_at <= now)
    ):
        raise DomainError("유효하지 않은 팝업 이미지입니다", code="invalid_popup_image", status=422)
    if image.upload_completed_at is None:
        raise DomainError(
            "업로드가 완료되지 않은 이미지입니다", code="popup_image_not_completed", status=422
        )
    image.entity_type = IMAGE_LINKED_TYPE
    image.entity_id = str(row.id)
    image.expires_at = None
    _expire(current)
    return image


@admin_router.get("", response_model=list[AdminPopupNoticeOut])
async def list_admin_popups(
    session: SessionDep, admin: AdminUser, request: Request
) -> list[AdminPopupNoticeOut]:
    rows = list(
        await session.scalars(
            select(PopupNotice).order_by(PopupNotice.created_at.desc(), PopupNotice.id)
        )
    )
    images = await _linked_images(session, (row.id for row in rows))
    today = _today_kst()
    settings = request.app.state.settings
    return [_admin_out(row, images.get(str(row.id)), settings, today) for row in rows]


@admin_router.post("", response_model=AdminPopupNoticeOut, status_code=201)
async def create_admin_popup(
    body: PopupNoticeCreateRequest,
    session: SessionDep,
    admin: AdminUser,
    request: Request,
) -> AdminPopupNoticeOut:
    """등록 직후는 비활성 — `enabled`를 켜야 store에 노출된다."""
    row = PopupNotice(
        template=body.fields.template,
        title=body.title.strip(),
        title_emphasis=_clean(body.title_emphasis),
        body=_clean(body.body),
        fields=body.fields.model_dump(mode="json"),
        link_url=_clean(body.link_url),
        starts_on=body.starts_on,
        ends_on=body.ends_on,
    )
    session.add(row)
    await session.flush()
    image = None
    if body.fields.template == "event":
        image = await _link_image(session, row, body.fields.image_upload_id, admin.id)
    await session.commit()
    await session.refresh(row)
    return _admin_out(row, image, request.app.state.settings, _today_kst())


@admin_router.patch("/{popup_id}", response_model=AdminPopupNoticeOut)
async def update_admin_popup(
    popup_id: uuid.UUID,
    body: PopupNoticeUpdateRequest,
    session: SessionDep,
    admin: AdminUser,
    request: Request,
) -> AdminPopupNoticeOut:
    row = await _popup_or_404(session, popup_id)
    changes = body.model_dump(exclude_unset=True)
    if "fields" in changes and body.fields is None:
        raise DomainError("템플릿 필드는 비울 수 없습니다", code="invalid_popup_fields", status=422)
    for key in ("title_emphasis", "body", "link_url"):
        if key in changes:
            setattr(row, key, _clean(changes[key]))
    if "title" in changes:
        row.title = changes["title"].strip()
    for key in ("starts_on", "ends_on", "enabled"):
        if key in changes:
            setattr(row, key, changes[key])
    if body.fields is not None:
        row.template = body.fields.template
        row.fields = body.fields.model_dump(mode="json")
    validate_period(row.starts_on, row.ends_on)
    validate_link(row.template, row.link_url)

    if row.template == "event":
        image = await _link_image(session, row, uuid.UUID(row.fields["image_upload_id"]), admin.id)
    else:
        # 템플릿이 이벤트에서 바뀌면 배너는 더 쓰이지 않는다.
        image = None
        _expire((await _linked_images(session, [row.id])).get(str(row.id)))
    await session.commit()
    await session.refresh(row)
    return _admin_out(row, image, request.app.state.settings, _today_kst())


@admin_router.delete("/{popup_id}", status_code=204)
async def delete_admin_popup(popup_id: uuid.UUID, session: SessionDep, admin: AdminUser) -> None:
    row = await _popup_or_404(session, popup_id)
    _expire((await _linked_images(session, [row.id])).get(str(row.id)))
    await session.delete(row)
    await session.commit()


# ── 배너 이미지 (상품 이미지 경로 복제) ──


@admin_router.post("/images/upload-url", response_model=PopupImageUploadOut)
async def create_admin_popup_image_upload_url(
    body: PopupImageUploadRequest,
    session: SessionDep,
    admin: AdminUser,
    request: Request,
) -> PopupImageUploadOut:
    extension = PurePosixPath(body.filename).suffix.lower()
    if (
        extension not in ALLOWED_IMAGE_EXTENSIONS
        or body.content_type not in ALLOWED_IMAGE_CONTENT_TYPES
    ):
        raise DomainError(
            "지원하지 않는 이미지 형식입니다", code="invalid_popup_image_type", status=422
        )
    object_key = f"{IMAGE_PREFIX}{uuid.uuid4().hex}{extension}"
    expires_at = datetime.now(UTC) + UPLOAD_TTL
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
        max_size_bytes=MAX_IMAGE_BYTES,
        bucket_name=assets_bucket_name(request.app.state.settings),
        create_only=True,
    )
    await session.commit()
    return PopupImageUploadOut(
        upload_id=image.id,
        upload_url=upload_url,
        required_headers={
            "Content-Type": body.content_type,
            "x-goog-content-length-range": f"1,{MAX_IMAGE_BYTES}",
            "x-goog-if-generation-match": "0",
        },
        expires_at=expires_at,
    )


@admin_router.post("/images/{upload_id}/complete", response_model=PopupImageCompleteOut)
async def complete_admin_popup_image_upload(
    upload_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
    request: Request,
) -> PopupImageCompleteOut:
    image = await session.scalar(select(Image).where(Image.id == upload_id).with_for_update())
    if image is None or image.entity_type != IMAGE_UPLOAD_TYPE:
        raise NotFoundError("팝업 이미지 업로드를 찾을 수 없습니다")
    if image.uploaded_by != admin.id:
        raise ConflictError(
            "팝업 이미지 소유권이 일치하지 않습니다", code="popup_image_ownership_conflict"
        )
    now = datetime.now(UTC)
    if (
        image.deleted_at is not None
        or image.deletion_claimed_at is not None
        or (image.expires_at is not None and image.expires_at <= now)
    ):
        raise DomainError(
            "팝업 이미지 업로드가 만료되었습니다", code="popup_image_expired", status=409
        )
    if (
        image.content_type not in ALLOWED_IMAGE_CONTENT_TYPES
        or image.size_bytes is None
        or not 0 < image.size_bytes <= MAX_IMAGE_BYTES
        or not image.object_key.startswith(IMAGE_PREFIX)
    ):
        raise DomainError("유효하지 않은 팝업 이미지입니다", code="invalid_popup_image", status=409)

    metadata = await request.app.state.gcs.object_metadata(
        image.object_key, bucket_name=assets_bucket_name(request.app.state.settings)
    )
    if metadata is None:
        raise DomainError("업로드된 팝업 이미지를 찾을 수 없습니다", code="upload_not_found")
    if not 0 < metadata.size_bytes <= MAX_IMAGE_BYTES:
        raise DomainError(
            "팝업 이미지는 10MB 이하여야 합니다", code="popup_image_too_large", status=422
        )
    if metadata.content_type != image.content_type:
        raise DomainError(
            "팝업 이미지 형식이 일치하지 않습니다", code="invalid_popup_image_type", status=422
        )
    if metadata.size_bytes != image.size_bytes:
        raise DomainError(
            "팝업 이미지 크기가 일치하지 않습니다", code="invalid_popup_image_size", status=422
        )
    image.upload_completed_at = now
    await session.commit()
    return PopupImageCompleteOut(
        upload_id=image.id,
        public_url=public_asset_url(request.app.state.settings, image.object_key),
        content_type=image.content_type,
        size_bytes=image.size_bytes,
        completed_at=now,
    )


@admin_router.delete("/images/{upload_id}", status_code=204)
async def delete_admin_popup_image_upload(
    upload_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> None:
    image = await session.scalar(select(Image).where(Image.id == upload_id).with_for_update())
    if image is None or image.entity_type != IMAGE_UPLOAD_TYPE:
        raise NotFoundError("팝업 이미지 업로드를 찾을 수 없습니다")
    if image.uploaded_by != admin.id:
        raise ConflictError(
            "팝업 이미지 소유권이 일치하지 않습니다", code="popup_image_ownership_conflict"
        )
    # 스테이징 행만 만료시키고 삭제는 정리 배치에 맡긴다(상품 이미지와 같은 이유).
    image.expires_at = datetime.now(UTC)
    image.deletion_claimed_at = None
    await session.commit()

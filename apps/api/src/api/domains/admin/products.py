import uuid
from datetime import UTC, date, datetime, timedelta
from pathlib import PurePosixPath
from typing import Annotated, Any, Never, cast
from urllib.parse import quote as urlquote

from db.models.commerce import Product, ProductOption
from db.models.images import Image
from fastapi import APIRouter, Query, Request
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import SessionDep
from api.deps import AdminUser
from api.domains.admin.helpers import kst_day_bounds
from api.domains.admin.product_schemas import (
    AdminProductCreateRequest,
    AdminProductDetailImageLegacyRef,
    AdminProductDetailImageOut,
    AdminProductDetailImageUploadRef,
    AdminProductDetailOut,
    AdminProductImageCompleteOut,
    AdminProductImageUploadOut,
    AdminProductImageUploadRequest,
    AdminProductOptionWrite,
    AdminProductSummaryOut,
    AdminProductUpdateRequest,
    ProductImageKind,
    ProductSort,
)
from api.domains.admin.schemas import Page
from api.domains.admin.types import SortDirection
from api.domains.products.schemas import Category, Color, Material, Pattern, ProductOptionOut
from api.errors import ConflictError, DomainError, NotFoundError
from api.integrations.gcs import assets_bucket_name, public_asset_url
from api.numbering import generate_number

router = APIRouter(prefix="/admin/products", tags=["admin-products"])

CODE_PREFIX = {"3fold": "3F", "sfolderato": "SF", "knit": "KN", "bowtie": "BT"}
DEFAULT_PAGE_LIMIT = 20
MAX_PAGE_LIMIT = 100
MIN_SEARCH_LENGTH = 2
MAX_PRODUCT_IMAGE_BYTES = 10 * 1024 * 1024
PRODUCT_UPLOAD_TTL = timedelta(hours=24)
PRODUCT_IMAGE_PREFIX = "products/staging/"
PRODUCT_UPLOAD_TYPES = {
    "primary": "product_primary_upload",
    "detail": "product_detail_upload",
}
PRODUCT_LINK_TYPES = {
    "primary": "product_primary",
    "detail": "product_detail",
}
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


def _assets_bucket(request: Request) -> str:
    settings = request.app.state.settings
    if settings.gcs_assets_bucket:
        return settings.gcs_assets_bucket
    if settings.env in ("local", "test") and request.app.state.gcs.capability_mode == "dry_run":
        # cleanup_images·public_asset_url이 쓰는 assets 버킷명과 일치해야 한다
        return assets_bucket_name(settings) or "dry-run-assets"
    raise DomainError(
        "상품 이미지 저장소를 사용할 수 없습니다",
        code="product_assets_unavailable",
        status=503,
    )


def _public_asset_url(settings, object_key: str) -> str:  # noqa: ANN001 — app state Settings
    url = public_asset_url(settings, object_key)
    if url is None:
        raise DomainError(
            "상품 이미지 공개 주소가 설정되지 않았습니다",
            code="product_assets_unavailable",
            status=503,
        )
    return url


def _product_filters(
    *,
    category: Category | None,
    color: Color | None,
    pattern: Pattern | None,
    material: Material | None,
    q: str | None,
    start_date: date | None,
    end_date: date | None,
) -> list[ColumnElement[bool]]:
    filters: list[ColumnElement[bool]] = []
    for column, value in (
        (Product.category, category),
        (Product.color, color),
        (Product.pattern, pattern),
        (Product.material, material),
    ):
        if value is not None:
            filters.append(column == value)
    if q is not None and (search := q.strip()):
        if len(search) < MIN_SEARCH_LENGTH:
            raise DomainError(
                f"Search query must be at least {MIN_SEARCH_LENGTH} characters",
                code="invalid_search",
            )
        filters.append(
            Product.name.icontains(search, autoescape=True)
            | Product.code.icontains(search, autoescape=True)
        )
    start_at, end_at = kst_day_bounds(start_date, end_date)
    if start_at is not None:
        filters.append(Product.created_at >= start_at)
    if end_at is not None:
        filters.append(Product.created_at < end_at)
    return filters


def _sort_clauses(sort: ProductSort, direction: SortDirection) -> tuple[Any, Any]:
    column = {
        "created_at": Product.created_at,
        "updated_at": Product.updated_at,
        "name": Product.name,
        "price": Product.price,
        "stock": Product.stock,
    }[sort]
    if direction == "asc":
        return column.asc().nulls_last(), Product.id.asc()
    return column.desc().nulls_last(), Product.id.desc()


def _summary(
    product: Product, option_count: int, option_stock_total: int | None
) -> AdminProductSummaryOut:
    return AdminProductSummaryOut(
        id=product.id,
        code=product.code,
        name=product.name,
        price=product.price,
        image=product.image,
        category=product.category,
        color=product.color,
        pattern=product.pattern,
        material=product.material,
        stock=product.stock,
        option_label=product.option_label,
        option_count=option_count,
        option_stock_total=option_stock_total,
        created_at=product.created_at,
        updated_at=product.updated_at,
    )


async def _load_options(
    session: AsyncSession, product_id: int, *, for_update: bool = False
) -> list[ProductOption]:
    query = (
        select(ProductOption)
        .where(ProductOption.product_id == product_id)
        .order_by(ProductOption.created_at, ProductOption.id)
    )
    if for_update:
        query = query.with_for_update()
    return list(await session.scalars(query))


async def _linked_product_image_ids(
    session: AsyncSession, product: Product
) -> tuple[uuid.UUID | None, list[uuid.UUID | None]]:
    images = list(
        await session.scalars(
            select(Image)
            .where(
                Image.entity_id == str(product.id),
                Image.entity_type.in_(PRODUCT_LINK_TYPES.values()),
                Image.deleted_at.is_(None),
            )
            .order_by(Image.created_at, Image.id)
        )
    )

    def _matches(url: str, image: Image) -> bool:
        return url.endswith(urlquote(image.object_key, safe="/"))

    primary_id = next(
        (
            image.id
            for image in images
            if image.entity_type == PRODUCT_LINK_TYPES["primary"] and _matches(product.image, image)
        ),
        None,
    )
    detail_ids: list[uuid.UUID | None] = []
    for url in product.detail_images or []:
        image_id = next(
            (
                image.id
                for image in images
                if image.entity_type == PRODUCT_LINK_TYPES["detail"] and _matches(url, image)
            ),
            None,
        )
        detail_ids.append(image_id)
    return primary_id, detail_ids


async def _detail(session: AsyncSession, product: Product) -> AdminProductDetailOut:
    options = await _load_options(session, product.id)
    image_upload_id, detail_image_upload_ids = await _linked_product_image_ids(session, product)
    option_stock_total = (
        None
        if not options or any(option.stock is None for option in options)
        else sum(option.stock for option in options if option.stock is not None)
    )
    summary = _summary(product, len(options), option_stock_total)
    return AdminProductDetailOut(
        **summary.model_dump(),
        detail_images=[
            AdminProductDetailImageOut(url=url, upload_id=detail_image_upload_ids[index])
            for index, url in enumerate(product.detail_images or [])
        ],
        image_upload_id=image_upload_id,
        info=product.info,
        options=[ProductOptionOut.model_validate(option) for option in options],
    )


def _constraint_name(exc: IntegrityError) -> str:
    return str(exc.orig)


async def _raise_product_integrity_error(session: AsyncSession, exc: IntegrityError) -> Never:
    await session.rollback()
    constraint = _constraint_name(exc)
    mappings = (
        (
            "uq_product_options_product_id_name",
            "옵션 이름은 상품 안에서 중복될 수 없습니다",
            "duplicate_option_name",
            409,
        ),
        ("ck_products_price", "상품 가격은 0 이상이어야 합니다", "invalid_product_price", 422),
        ("ck_products_stock", "상품 재고는 0 이상이어야 합니다", "invalid_product_stock", 422),
        (
            "ck_product_options_additional_price",
            "옵션 추가 금액은 0 이상이어야 합니다",
            "invalid_option_price",
            422,
        ),
        (
            "ck_product_options_stock",
            "옵션 재고는 0 이상이어야 합니다",
            "invalid_option_stock",
            422,
        ),
        ("uq_products_code", "이미 사용 중인 상품 코드입니다", "product_code_conflict", 409),
    )
    for name, detail, code, status in mappings:
        if name in constraint:
            raise DomainError(detail, code=code, status=status) from exc
    raise ConflictError("상품 저장 중 데이터 충돌이 발생했습니다") from exc


def _validate_option_payload(options: list[AdminProductOptionWrite]) -> None:
    ids = [option.id for option in options if option.id is not None]
    if len(ids) != len(set(ids)):
        raise DomainError(
            "같은 옵션 ID를 두 번 사용할 수 없습니다",
            code="duplicate_option_id",
            status=422,
        )
    if any(not option.name.strip() for option in options):
        raise DomainError("옵션 이름을 입력해 주세요", code="invalid_option_name", status=422)


def _validate_product_name(name: str) -> str:
    normalized = name.strip()
    if not normalized:
        raise DomainError("상품 이름을 입력해 주세요", code="invalid_product_name", status=422)
    return normalized


async def _apply_option_diff(
    session: AsyncSession,
    product: Product,
    existing: list[ProductOption],
    requested: list[AdminProductOptionWrite],
) -> None:
    _validate_option_payload(requested)
    existing_by_id = {option.id: option for option in existing}
    requested_ids = {option.id for option in requested if option.id is not None}
    unknown_ids = requested_ids - existing_by_id.keys()
    if unknown_ids:
        raise DomainError(
            "다른 상품이거나 존재하지 않는 옵션 ID가 포함되어 있습니다",
            code="invalid_option_reference",
            status=409,
        )

    for option in existing:
        if option.id not in requested_ids:
            await session.delete(option)

    for item in requested:
        values = {
            "name": item.name.strip(),
            "additional_price": item.additional_price,
            "stock": item.stock,
        }
        if item.id is None:
            session.add(ProductOption(product_id=product.id, **values))
        else:
            option = existing_by_id[item.id]
            for field, value in values.items():
                setattr(option, field, value)

    if requested:
        product.stock = None


async def _resolve_product_images(
    session: AsyncSession,
    admin_id: uuid.UUID,
    *,
    product_id: int | None,
    primary_id: uuid.UUID | None,
    detail_ids: list[uuid.UUID] | None,
) -> tuple[Image | None, list[Image] | None]:
    requested_ids = ([primary_id] if primary_id is not None else []) + (detail_ids or [])
    if len(requested_ids) != len(set(requested_ids)):
        raise DomainError(
            "같은 상품 이미지를 두 번 사용할 수 없습니다",
            code="duplicate_product_image",
            status=422,
        )
    if not requested_ids:
        return None, [] if detail_ids is not None else None

    images = list(
        await session.scalars(select(Image).where(Image.id.in_(requested_ids)).with_for_update())
    )
    by_id = {image.id: image for image in images}
    now = datetime.now(UTC)

    def _validate(image_id: uuid.UUID, kind: ProductImageKind) -> Image:
        image = by_id.get(image_id)
        if image is None:
            raise DomainError(
                "유효하지 않은 상품 이미지입니다",
                code="invalid_product_image",
                status=409,
            )
        is_staged = image.entity_type == PRODUCT_UPLOAD_TYPES[kind]
        is_linked = (
            product_id is not None
            and image.entity_type == PRODUCT_LINK_TYPES[kind]
            and image.entity_id == str(product_id)
        )
        if not is_staged and not is_linked:
            raise DomainError(
                "다른 상품이거나 유효하지 않은 상품 이미지입니다",
                code="invalid_product_image",
                status=409,
            )
        if is_staged and image.uploaded_by != admin_id:
            raise ConflictError(
                "상품 이미지 소유권이 일치하지 않습니다",
                code="product_image_ownership_conflict",
            )
        if (
            image.deleted_at is not None
            or image.deletion_claimed_at is not None
            or (image.expires_at is not None and image.expires_at <= now)
        ):
            raise DomainError(
                "상품 이미지가 만료되었거나 삭제되었습니다",
                code="product_image_expired",
                status=409,
            )
        if image.upload_completed_at is None:
            raise DomainError(
                "상품 이미지 업로드를 먼저 완료해 주세요",
                code="product_image_not_completed",
                status=409,
            )
        if not image.object_key.startswith(PRODUCT_IMAGE_PREFIX):
            raise DomainError(
                "유효하지 않은 상품 이미지 경로입니다",
                code="invalid_product_image",
                status=409,
            )
        return image

    primary = _validate(primary_id, "primary") if primary_id is not None else None
    details = (
        [_validate(image_id, "detail") for image_id in detail_ids]
        if detail_ids is not None
        else None
    )
    return primary, details


async def _link_product_images(
    session: AsyncSession,
    product: Product,
    *,
    primary: Image | None,
    details: list[Image] | None,
) -> None:
    replace_types: set[str] = set()
    if primary is not None:
        replace_types.add(PRODUCT_LINK_TYPES["primary"])
    if details is not None:
        replace_types.add(PRODUCT_LINK_TYPES["detail"])

    if replace_types:
        previous = list(
            await session.scalars(
                select(Image)
                .where(
                    Image.entity_id == str(product.id),
                    Image.entity_type.in_(replace_types),
                )
                .with_for_update()
            )
        )
        # 주문 snapshot이 가리킬 수 있어 확정된 과거 상품 이미지는 삭제하지 않는다.
        for image in previous:
            image.entity_type = "product_archived"

    if primary is not None:
        primary.entity_type = PRODUCT_LINK_TYPES["primary"]
        primary.entity_id = str(product.id)
        primary.expires_at = None
        primary.deletion_claimed_at = None
    for image in details or []:
        image.entity_type = PRODUCT_LINK_TYPES["detail"]
        image.entity_id = str(product.id)
        image.expires_at = None
        image.deletion_claimed_at = None


@router.get("", response_model=Page[AdminProductSummaryOut])
async def admin_list_products(
    session: SessionDep,
    admin: AdminUser,
    category: Category | None = None,
    color: Color | None = None,
    pattern: Pattern | None = None,
    material: Material | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    start_date: date | None = None,
    end_date: date | None = None,
    sort: ProductSort = "created_at",
    direction: SortDirection = "desc",
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_LIMIT)] = DEFAULT_PAGE_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[AdminProductSummaryOut]:
    filters = _product_filters(
        category=category,
        color=color,
        pattern=pattern,
        material=material,
        q=q,
        start_date=start_date,
        end_date=end_date,
    )
    total = await session.scalar(select(func.count()).select_from(Product).where(*filters))
    option_count = (
        select(func.count())
        .where(ProductOption.product_id == Product.id)
        .correlate(Product)
        .scalar_subquery()
    )
    option_stock_sum = (
        select(func.coalesce(func.sum(ProductOption.stock), 0))
        .where(ProductOption.product_id == Product.id)
        .correlate(Product)
        .scalar_subquery()
    )
    has_unlimited_option = (
        select(func.count())
        .where(
            ProductOption.product_id == Product.id,
            ProductOption.stock.is_(None),
        )
        .correlate(Product)
        .scalar_subquery()
    )
    rows = (
        await session.execute(
            select(
                Product,
                option_count.label("option_count"),
                option_stock_sum.label("option_stock_sum"),
                has_unlimited_option.label("has_unlimited_option"),
            )
            .where(*filters)
            .order_by(*_sort_clauses(sort, direction))
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return Page(
        items=[
            _summary(
                product,
                count,
                None if count == 0 or unlimited_count > 0 else int(stock_sum),
            )
            for product, count, stock_sum, unlimited_count in rows
        ],
        total=total or 0,
        limit=limit,
        offset=offset,
    )


@router.post("/images/upload-url", response_model=AdminProductImageUploadOut)
async def create_admin_product_image_upload_url(
    body: AdminProductImageUploadRequest,
    session: SessionDep,
    admin: AdminUser,
    request: Request,
) -> AdminProductImageUploadOut:
    extension = PurePosixPath(body.filename).suffix.lower()
    if (
        extension not in ALLOWED_IMAGE_EXTENSIONS
        or body.content_type not in ALLOWED_IMAGE_CONTENT_TYPES
    ):
        raise DomainError(
            "지원하지 않는 상품 이미지 형식입니다",
            code="invalid_product_image_type",
            status=422,
        )
    object_key = f"{PRODUCT_IMAGE_PREFIX}{uuid.uuid4().hex}{extension}"
    expires_at = datetime.now(UTC) + PRODUCT_UPLOAD_TTL
    image = Image(
        object_key=object_key,
        entity_type=PRODUCT_UPLOAD_TYPES[body.kind],
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
        max_size_bytes=MAX_PRODUCT_IMAGE_BYTES,
        bucket_name=_assets_bucket(request),
        create_only=True,
    )
    await session.commit()
    return AdminProductImageUploadOut(
        upload_id=image.id,
        upload_url=upload_url,
        required_headers={
            "Content-Type": body.content_type,
            "x-goog-content-length-range": f"1,{MAX_PRODUCT_IMAGE_BYTES}",
            "x-goog-if-generation-match": "0",
        },
        expires_at=expires_at,
        upload_required=request.app.state.gcs.upload_required,
    )


@router.post(
    "/images/{upload_id}/complete",
    response_model=AdminProductImageCompleteOut,
)
async def complete_admin_product_image_upload(
    upload_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
    request: Request,
) -> AdminProductImageCompleteOut:
    image = await session.scalar(select(Image).where(Image.id == upload_id).with_for_update())
    upload_types = {value: key for key, value in PRODUCT_UPLOAD_TYPES.items()}
    if image is None or image.entity_type not in upload_types:
        raise NotFoundError("상품 이미지 업로드를 찾을 수 없습니다")
    if image.uploaded_by != admin.id:
        raise ConflictError(
            "상품 이미지 소유권이 일치하지 않습니다",
            code="product_image_ownership_conflict",
        )
    now = datetime.now(UTC)
    if (
        image.deleted_at is not None
        or image.deletion_claimed_at is not None
        or (image.expires_at is not None and image.expires_at <= now)
    ):
        raise DomainError(
            "상품 이미지 업로드가 만료되었습니다",
            code="product_image_expired",
            status=409,
        )
    if (
        image.content_type not in ALLOWED_IMAGE_CONTENT_TYPES
        or image.size_bytes is None
        or not 0 < image.size_bytes <= MAX_PRODUCT_IMAGE_BYTES
        or not image.object_key.startswith(PRODUCT_IMAGE_PREFIX)
    ):
        raise DomainError(
            "유효하지 않은 상품 이미지입니다",
            code="invalid_product_image",
            status=409,
        )

    metadata = await request.app.state.gcs.object_metadata(
        image.object_key,
        bucket_name=_assets_bucket(request),
    )
    if request.app.state.gcs.upload_required:
        if metadata is None:
            raise DomainError(
                "업로드된 상품 이미지를 찾을 수 없습니다",
                code="upload_not_found",
            )
        if not 0 < metadata.size_bytes <= MAX_PRODUCT_IMAGE_BYTES:
            raise DomainError(
                "상품 이미지는 10MB 이하여야 합니다",
                code="product_image_too_large",
                status=422,
            )
        if metadata.content_type != image.content_type:
            raise DomainError(
                "상품 이미지 형식이 일치하지 않습니다",
                code="invalid_product_image_type",
                status=422,
            )
        if metadata.size_bytes != image.size_bytes:
            raise DomainError(
                "상품 이미지 크기가 일치하지 않습니다",
                code="invalid_product_image_size",
                status=422,
            )
    image.upload_completed_at = now
    await session.commit()
    kind = cast(ProductImageKind, upload_types[image.entity_type])
    return AdminProductImageCompleteOut(
        upload_id=image.id,
        kind=kind,
        public_url=_public_asset_url(request.app.state.settings, image.object_key),
        content_type=image.content_type,
        size_bytes=image.size_bytes,
        completed_at=now,
    )


@router.delete("/images/{upload_id}", status_code=204)
async def delete_admin_product_image_upload(
    upload_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
) -> None:
    image = await session.scalar(select(Image).where(Image.id == upload_id).with_for_update())
    if image is None or image.entity_type not in PRODUCT_UPLOAD_TYPES.values():
        raise NotFoundError("상품 이미지 업로드를 찾을 수 없습니다")
    if image.uploaded_by != admin.id:
        raise ConflictError(
            "상품 이미지 소유권이 일치하지 않습니다",
            code="product_image_ownership_conflict",
        )
    # Expire the staged row and let cleanup acquire the deletion lease. Writing a
    # fresh lease here would make the first cleanup look like a concurrent retry
    # and delay an explicit admin deletion.
    image.expires_at = datetime.now(UTC)
    image.deletion_claimed_at = None
    await session.commit()


@router.get("/{product_id}", response_model=AdminProductDetailOut)
async def admin_get_product(
    product_id: int, session: SessionDep, admin: AdminUser
) -> AdminProductDetailOut:
    product = await session.get(Product, product_id)
    if product is None:
        raise NotFoundError("상품을 찾을 수 없습니다")
    return await _detail(session, product)


@router.post("", response_model=AdminProductDetailOut, status_code=201)
async def admin_create_product(
    body: AdminProductCreateRequest,
    session: SessionDep,
    admin: AdminUser,
    request: Request,
) -> AdminProductDetailOut:
    try:
        primary, details = await _resolve_product_images(
            session,
            admin.id,
            product_id=None,
            primary_id=body.image_upload_id,
            detail_ids=body.detail_image_upload_ids,
        )
        if primary is None or details is None:
            raise DomainError(
                "대표 상품 이미지를 선택해 주세요",
                code="product_image_required",
                status=422,
            )
        code = body.code
        if code is not None:
            code = code.strip()
            if not code:
                raise DomainError(
                    "상품 코드를 입력해 주세요", code="invalid_product_code", status=422
                )
        else:
            code = await generate_number(session, Product.code, CODE_PREFIX[body.category])
        product_values = body.model_dump(
            exclude={
                "code",
                "options",
                "image_upload_id",
                "detail_image_upload_ids",
            }
        )
        product_values["name"] = _validate_product_name(body.name)
        product_values["image"] = _public_asset_url(request.app.state.settings, primary.object_key)
        product_values["detail_images"] = [
            _public_asset_url(request.app.state.settings, image.object_key) for image in details
        ] or None
        product = Product(**product_values, code=code)
        session.add(product)
        await session.flush()
        await _link_product_images(session, product, primary=primary, details=details)
        await _apply_option_diff(session, product, [], body.options)
        await session.commit()
    except IntegrityError as exc:
        await _raise_product_integrity_error(session, exc)
    await session.refresh(product)
    return await _detail(session, product)


@router.patch("/{product_id}", response_model=AdminProductDetailOut)
async def admin_update_product(
    product_id: int,
    body: AdminProductUpdateRequest,
    session: SessionDep,
    admin: AdminUser,
    request: Request,
) -> AdminProductDetailOut:
    try:
        product = await session.scalar(
            select(Product).where(Product.id == product_id).with_for_update()
        )
        if product is None:
            raise NotFoundError("상품을 찾을 수 없습니다")
        if product.updated_at.astimezone(UTC) != body.expected_updated_at.astimezone(UTC):
            raise DomainError(
                "다른 관리자가 먼저 상품을 변경했습니다",
                code="stale_product",
                status=409,
            )

        details_requested = "detail_images" in body.model_fields_set
        detail_refs = body.detail_images if details_requested else None
        detail_ids = (
            [
                ref.upload_id
                for ref in detail_refs
                if isinstance(ref, AdminProductDetailImageUploadRef)
            ]
            if detail_refs is not None
            else None
        )
        primary, details = await _resolve_product_images(
            session,
            admin.id,
            product_id=product.id,
            primary_id=body.image_upload_id,
            detail_ids=detail_ids,
        )
        existing_options = await _load_options(session, product.id, for_update=True)
        changes = body.model_dump(
            exclude={
                "expected_updated_at",
                "options",
                "image_upload_id",
                "detail_images",
            },
            exclude_unset=True,
        )
        required_fields = {
            "name",
            "price",
            "category",
            "color",
            "pattern",
            "material",
            "info",
        }
        if any(changes.get(field) is None for field in required_fields & changes.keys()):
            raise DomainError(
                "필수 상품 필드는 null로 변경할 수 없습니다",
                code="invalid_product_field",
                status=422,
            )
        if "name" in changes:
            changes["name"] = _validate_product_name(changes["name"])
        for field, value in changes.items():
            setattr(product, field, value)

        if primary is not None:
            product.image = _public_asset_url(request.app.state.settings, primary.object_key)
        if detail_refs is not None and details is not None:
            _, current_detail_ids = await _linked_product_image_ids(session, product)
            legacy_urls = {
                url
                for url, image_id in zip(
                    product.detail_images or [], current_detail_ids, strict=True
                )
                if image_id is None
            }
            requested_legacy_urls = [
                ref.legacy_url
                for ref in detail_refs
                if isinstance(ref, AdminProductDetailImageLegacyRef)
            ]
            if len(requested_legacy_urls) != len(set(requested_legacy_urls)):
                raise DomainError(
                    "같은 상품 이미지를 두 번 사용할 수 없습니다",
                    code="duplicate_product_image",
                    status=422,
                )
            if any(url not in legacy_urls for url in requested_legacy_urls):
                raise DomainError(
                    "현재 상품에 없는 레거시 이미지입니다",
                    code="invalid_legacy_product_image",
                    status=409,
                )
            resolved_details = iter(details)
            product.detail_images = [
                ref.legacy_url
                if isinstance(ref, AdminProductDetailImageLegacyRef)
                else _public_asset_url(
                    request.app.state.settings, next(resolved_details).object_key
                )
                for ref in detail_refs
            ] or None
        await _link_product_images(session, product, primary=primary, details=details)

        if body.options is not None:
            await _apply_option_diff(session, product, existing_options, body.options)
        elif existing_options:
            product.stock = None
        product.updated_at = datetime.now(UTC)
        await session.commit()
    except IntegrityError as exc:
        await _raise_product_integrity_error(session, exc)
    await session.refresh(product)
    return await _detail(session, product)

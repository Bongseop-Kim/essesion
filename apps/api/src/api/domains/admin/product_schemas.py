import uuid
from datetime import datetime
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from api.domains.products.schemas import (
    Category,
    Color,
    Material,
    Pattern,
    ProductOptionOut,
)

ProductSort = Literal["created_at", "updated_at", "name", "price", "stock"]


class AdminProductOptionWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=100)
    additional_price: int = 0
    stock: int | None = None


class AdminProductDetailImageUploadRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    upload_id: uuid.UUID


class AdminProductCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    price: int
    image_upload_id: uuid.UUID
    detail_image_upload_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)
    category: Category
    color: Color
    pattern: Pattern
    material: Material
    info: str
    code: str | None = None
    stock: int | None = None
    option_label: str | None = None
    options: list[AdminProductOptionWrite] = Field(default_factory=list, max_length=100)


class AdminProductUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_updated_at: AwareDatetime
    name: str | None = None
    price: int | None = None
    image_upload_id: uuid.UUID | None = None
    detail_images: list[AdminProductDetailImageUploadRef] | None = Field(
        default=None, max_length=20
    )
    category: Category | None = None
    color: Color | None = None
    pattern: Pattern | None = None
    material: Material | None = None
    info: str | None = None
    stock: int | None = None
    option_label: str | None = None
    options: list[AdminProductOptionWrite] | None = Field(default=None, max_length=100)


ProductImageKind = Literal["primary", "detail"]


class AdminProductImageUploadRequest(BaseModel):
    kind: ProductImageKind
    filename: str = Field(min_length=1, max_length=255)
    content_type: str
    size_bytes: int = Field(gt=0, le=10 * 1024 * 1024)


class AdminProductImageUploadOut(BaseModel):
    upload_id: uuid.UUID
    upload_url: str
    required_headers: dict[str, str]
    expires_at: datetime
    upload_required: bool


class AdminProductImageCompleteOut(BaseModel):
    upload_id: uuid.UUID
    kind: ProductImageKind
    public_url: str
    content_type: str
    size_bytes: int
    completed_at: datetime


class AdminProductSummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str | None
    name: str
    price: int
    image: str
    category: str
    color: str
    pattern: str
    material: str
    stock: int | None
    option_label: str | None
    option_count: int
    option_stock_total: int | None
    created_at: datetime
    updated_at: datetime


class AdminProductDetailImageOut(BaseModel):
    url: str
    upload_id: uuid.UUID


class AdminProductDetailOut(AdminProductSummaryOut):
    detail_images: list[AdminProductDetailImageOut] = Field(default_factory=list)
    image_upload_id: uuid.UUID
    info: str
    options: list[ProductOptionOut] = Field(default_factory=list)

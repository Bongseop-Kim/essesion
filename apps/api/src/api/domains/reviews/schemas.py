import uuid
from datetime import datetime
from typing import Annotated, Literal, cast

from pydantic import AfterValidator, BaseModel, Field

ReviewOrderType = Literal["sale", "repair", "custom", "sample"]
ServiceReviewOrderType = Literal["repair", "custom", "sample"]

MAX_REVIEW_PHOTOS = 5
MAX_REVIEW_PHOTO_BYTES = 10 * 1024 * 1024


def _require_content(value: str) -> str:
    v = value.strip()
    if not v:
        raise ValueError("후기 내용을 입력해 주세요")
    return v


ReviewContent = Annotated[
    str, Field(min_length=1, max_length=1000), AfterValidator(_require_content)
]


class ReviewCreateRequest(BaseModel):
    order_id: uuid.UUID
    order_item_id: uuid.UUID | None = None
    rating: int = Field(ge=1, le=5)
    content: ReviewContent
    photo_upload_ids: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_REVIEW_PHOTOS)


class ReviewUpdateRequest(BaseModel):
    rating: int = Field(default=cast(int, None), ge=1, le=5)
    content: ReviewContent = cast(str, None)
    photo_upload_ids: list[uuid.UUID] = Field(
        default=cast(list[uuid.UUID], None), max_length=MAX_REVIEW_PHOTOS
    )


class ReviewPhotoUploadRequest(BaseModel):
    filename: str
    content_type: str
    size_bytes: int = Field(gt=0, le=MAX_REVIEW_PHOTO_BYTES)


class ReviewPhotoUploadOut(BaseModel):
    upload_id: uuid.UUID
    upload_url: str
    required_headers: dict[str, str]
    expires_at: datetime
    upload_required: bool


class ReviewPhotoUploadCompleteOut(BaseModel):
    upload_id: uuid.UUID
    completed_at: datetime


class ReviewPhotoOut(BaseModel):
    upload_id: uuid.UUID
    url: str


class ReviewOut(BaseModel):
    id: uuid.UUID
    rating: int
    content: str
    created_at: datetime
    order_type: ReviewOrderType
    product_id: int | None
    author_name: str
    photos: list[ReviewPhotoOut]


class ReviewListOut(BaseModel):
    items: list[ReviewOut]
    total: int
    avg_rating: float
    limit: int
    offset: int

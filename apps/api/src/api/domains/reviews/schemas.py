import uuid
from datetime import datetime
from typing import Literal, cast

from pydantic import BaseModel, Field, field_validator

ReviewOrderType = Literal["sale", "repair", "custom", "sample"]
ServiceReviewOrderType = Literal["repair", "custom", "sample"]


class ReviewCreateRequest(BaseModel):
    order_id: uuid.UUID
    order_item_id: uuid.UUID | None = None
    rating: int = Field(ge=1, le=5)
    content: str = Field(min_length=1, max_length=1000)

    @field_validator("content")
    @classmethod
    def strip_content(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("후기 내용을 입력해 주세요")
        return value


class ReviewUpdateRequest(BaseModel):
    rating: int = Field(default=cast(int, None), ge=1, le=5)
    content: str = Field(default=cast(str, None), min_length=1, max_length=1000)

    @field_validator("content")
    @classmethod
    def strip_content(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("후기 내용을 입력해 주세요")
        return value


class ReviewOut(BaseModel):
    id: uuid.UUID
    rating: int
    content: str
    created_at: datetime
    order_type: ReviewOrderType
    product_id: int | None
    author_name: str


class ReviewListOut(BaseModel):
    items: list[ReviewOut]
    total: int
    avg_rating: float
    limit: int
    offset: int

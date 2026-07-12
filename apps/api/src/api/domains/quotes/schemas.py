import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from api.domains.orders.schemas import ReferenceImageIn


class QuoteCreateRequest(BaseModel):
    shipping_address_id: uuid.UUID
    options: dict[str, Any]
    quantity: int
    contact_name: str
    contact_method: Literal["email", "phone"]
    contact_value: str
    business_name: str = ""
    additional_notes: str = ""
    reference_images: list[ReferenceImageIn] = Field(default_factory=list, max_length=5)


class QuoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    quote_number: str
    shipping_address_id: uuid.UUID | None
    shipping_address_snapshot: dict[str, Any] | None
    options: dict[str, Any]
    quantity: int
    additional_notes: str
    contact_name: str
    business_name: str
    contact_method: str
    contact_value: str
    status: str
    quoted_amount: int | None
    quote_conditions: str | None
    admin_memo: str | None
    reference_images: list[Any]
    created_at: datetime
    updated_at: datetime

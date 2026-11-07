import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, Field

from api.domains.orders.schemas import (
    MAX_ADDITIONAL_NOTES_LENGTH,
    MAX_ORDER_QUANTITY,
    MAX_REFERENCE_IMAGES,
    OptionsPayload,
    ReferenceImageIn,
    _unique_reference_parts,
)
from api.schemas import ORMModel


class QuoteCreateRequest(BaseModel):
    shipping_address_id: uuid.UUID
    options: OptionsPayload
    quantity: int = Field(le=MAX_ORDER_QUANTITY)
    contact_name: str = Field(max_length=100)
    contact_method: Literal["email", "phone"]
    contact_value: str = Field(max_length=320)
    business_name: str = Field(default="", max_length=200)
    additional_notes: str = Field(default="", max_length=MAX_ADDITIONAL_NOTES_LENGTH)
    reference_images: Annotated[
        list[ReferenceImageIn],
        Field(max_length=MAX_REFERENCE_IMAGES),
        AfterValidator(_unique_reference_parts),
    ] = Field(default_factory=list)


class QuoteOut(ORMModel):
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

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import AwareDatetime, BaseModel, Field

from api.domains.admin.types import SortDirection

InquiryStatusFilter = Literal["all", "답변대기", "답변완료"]
InquiryCategoryFilter = Literal["all", "일반", "상품", "수선", "주문제작", "샘플제작"]
InquirySort = Literal["created_at", "updated_at", "status"]


class AdminInquiryCustomerOut(BaseModel):
    id: uuid.UUID
    email: str | None
    name: str
    phone: str | None


class AdminInquiryProductOut(BaseModel):
    id: int
    code: str | None
    name: str


class AdminInquiryActorOut(BaseModel):
    id: uuid.UUID
    email: str | None
    name: str


class AdminInquirySummaryOut(BaseModel):
    id: uuid.UUID
    category: str
    title: str
    status: str
    is_secret: bool
    answer_date: datetime | None
    created_at: datetime
    updated_at: datetime
    customer: AdminInquiryCustomerOut | None
    product: AdminInquiryProductOut | None


class AdminInquiryDetailOut(AdminInquirySummaryOut):
    content: str
    answer: str | None
    answered_by: uuid.UUID | None
    answer_actor: AdminInquiryActorOut | None


class AdminInquirySearchRequest(BaseModel):
    q: str = Field(min_length=2, max_length=100)
    status: InquiryStatusFilter = "all"
    category: InquiryCategoryFilter = "all"
    start_date: date | None = None
    end_date: date | None = None
    sort: InquirySort = "created_at"
    direction: SortDirection = "desc"
    limit: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class AdminInquiryAnswerRequest(BaseModel):
    expected_updated_at: AwareDatetime
    answer: str = Field(min_length=1, max_length=5000)

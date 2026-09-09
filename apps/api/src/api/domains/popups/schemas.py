"""팝업 공지 스키마 — 템플릿별 `fields`는 discriminated union으로 검증한다.

관리자는 템플릿을 고르고 빈칸만 채운다. 달력·범례·표 같은 시각 요소는 store가 이 필드에서
그리므로, 여기서 순서·개수를 확정해 두는 것이 화면이 깨지지 않는 유일한 방어선이다.
"""

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

from api.errors import DomainError
from api.schemas import StrictModel

PopupTemplate = Literal["holiday", "operation", "event"]

MAX_TITLE_LENGTH = 60
MAX_BODY_LENGTH = 500
MAX_FOOTNOTE_LENGTH = 200
MAX_LINK_LENGTH = 500
MAX_OPERATION_ROWS = 4
# 링크는 store 내부 경로 또는 https만 — javascript: 같은 스킴을 문자열 단계에서 막는다.
LINK_URL_PATTERN = r"^(https://.+|/([^/].*)?)$"
TIME_PATTERN = r"^([01]\d|2[0-3]):[0-5]\d$"


class HolidayFields(StrictModel):
    """휴무·명절 안내 — 날짜 4개로 달력과 범례가 자동 생성된다."""

    template: Literal["holiday"]
    cutoff_on: date
    cutoff_time: str = Field(pattern=TIME_PATTERN, description="KST HH:MM")
    closed_from: date
    closed_to: date
    resume_on: date
    footnote: str | None = Field(default=None, max_length=MAX_FOOTNOTE_LENGTH)

    @model_validator(mode="after")
    def _ordered(self) -> "HolidayFields":
        if not (self.cutoff_on <= self.closed_from <= self.closed_to < self.resume_on):
            raise ValueError("날짜 순서는 마감일 ≤ 휴무 시작 ≤ 휴무 종료 < 재개일이어야 합니다")
        return self


class OperationRow(StrictModel):
    label: str = Field(min_length=1, max_length=20)
    value: str = Field(min_length=1, max_length=80)


class OperationFields(StrictModel):
    """배송·운영 안내 — 라벨·값 표."""

    template: Literal["operation"]
    rows: list[OperationRow] = Field(min_length=1, max_length=MAX_OPERATION_ROWS)
    footnote: str | None = Field(default=None, max_length=MAX_FOOTNOTE_LENGTH)


class EventFields(StrictModel):
    """이벤트·프로모션 — 배너 이미지가 주인공. 이미지는 admin 업로드를 완료한 행이어야 한다."""

    template: Literal["event"]
    image_upload_id: uuid.UUID


PopupFields = Annotated[
    HolidayFields | OperationFields | EventFields, Field(discriminator="template")
]


class _PopupBase(StrictModel):
    title: str = Field(min_length=1, max_length=MAX_TITLE_LENGTH)
    title_emphasis: str | None = Field(default=None, max_length=MAX_TITLE_LENGTH)
    body: str | None = Field(default=None, max_length=MAX_BODY_LENGTH)
    link_url: str | None = Field(default=None, max_length=MAX_LINK_LENGTH, pattern=LINK_URL_PATTERN)


class PopupNoticeCreateRequest(_PopupBase):
    fields: PopupFields
    starts_on: date
    ends_on: date

    @model_validator(mode="after")
    def _consistent(self) -> "PopupNoticeCreateRequest":
        # 요청 모델 안에서는 ValueError(422 표준 형식).
        # PATCH는 병합 뒤 router가 같은 규칙을 DomainError로 낸다.
        if self.ends_on < self.starts_on:
            raise ValueError(PERIOD_ERROR)
        if self.fields.template == "event" and not self.link_url:
            raise ValueError(LINK_REQUIRED_ERROR)
        return self


class PopupNoticeUpdateRequest(StrictModel):
    """생략은 "안 바꿈", null은 "지움"(exclude_unset으로 구분)."""

    title: str | None = Field(default=None, min_length=1, max_length=MAX_TITLE_LENGTH)
    title_emphasis: str | None = Field(default=None, max_length=MAX_TITLE_LENGTH)
    body: str | None = Field(default=None, max_length=MAX_BODY_LENGTH)
    link_url: str | None = Field(default=None, max_length=MAX_LINK_LENGTH, pattern=LINK_URL_PATTERN)
    fields: PopupFields | None = None
    starts_on: date | None = None
    ends_on: date | None = None
    enabled: bool | None = None


PERIOD_ERROR = "종료일은 시작일보다 앞설 수 없습니다"
LINK_REQUIRED_ERROR = "이벤트 팝업은 링크가 필요합니다"


def validate_period(starts_on: date, ends_on: date) -> None:
    if ends_on < starts_on:
        raise DomainError(PERIOD_ERROR, code="invalid_popup_period", status=422)


def validate_link(template: str, link_url: str | None) -> None:
    if template == "event" and not link_url:
        raise DomainError(LINK_REQUIRED_ERROR, code="popup_link_required", status=422)


# ── 응답 ──


class PublicEventFields(BaseModel):
    template: Literal["event"]
    image_url: str


PublicPopupFields = Annotated[
    HolidayFields | OperationFields | PublicEventFields, Field(discriminator="template")
]


class PopupNoticeOut(BaseModel):
    """store 렌더에 필요한 것만 — 이미지는 공개 URL로 치환한다."""

    id: uuid.UUID
    template: PopupTemplate
    title: str
    title_emphasis: str | None
    body: str | None
    fields: PublicPopupFields
    link_url: str | None


class AdminEventFields(PublicEventFields):
    image_upload_id: uuid.UUID


AdminPopupFields = Annotated[
    HolidayFields | OperationFields | AdminEventFields, Field(discriminator="template")
]


class AdminPopupNoticeOut(BaseModel):
    id: uuid.UUID
    template: PopupTemplate
    title: str
    title_emphasis: str | None
    body: str | None
    fields: AdminPopupFields
    link_url: str | None
    starts_on: date
    ends_on: date
    enabled: bool
    # 계산값 — 운영자가 "지금 뭐가 보이나"를 목록에서 바로 알기 위한 것.
    active_now: bool
    created_at: datetime
    updated_at: datetime


class PopupImageUploadRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str
    size_bytes: int = Field(gt=0, le=10 * 1024 * 1024)


class PopupImageUploadOut(BaseModel):
    upload_id: uuid.UUID
    upload_url: str
    required_headers: dict[str, str]
    expires_at: datetime


class PopupImageCompleteOut(BaseModel):
    upload_id: uuid.UUID
    public_url: str
    content_type: str
    size_bytes: int
    completed_at: datetime

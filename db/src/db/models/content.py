"""운영 콘텐츠 — 운영자가 store에 띄우는 안내.

팝업 공지는 미리 디자인한 템플릿(holiday·operation·event) 중 하나를 골라 빈칸을 채우는
방식이다. 템플릿별 필드는 모양이 달라 `fields` JSONB에 두고 api(pydantic)가 검증한다 —
컬럼으로 풀면 nullable 컬럼이 10개를 넘는다. 노출 기간은 KST 날짜(`date`)로만 판정한다.
"""

import uuid
from datetime import date
from typing import Any

from sqlalchemy import CheckConstraint, Index, text
from sqlalchemy.orm import Mapped, mapped_column

from db.models.base import Base, TimestampMixin, uuid_pk


class PopupNotice(TimestampMixin, Base):
    __tablename__ = "popup_notices"

    id: Mapped[uuid.UUID] = uuid_pk()
    template: Mapped[str]
    title: Mapped[str]
    # 제목 뒤에 굵게 붙는 부분 — "추석 연휴" + "배송 안내".
    title_emphasis: Mapped[str | None]
    # 평문. `**굵게**` 마크만 허용하며 store가 해석한다.
    body: Mapped[str | None]
    fields: Mapped[dict[str, Any]] = mapped_column(server_default=text("'{}'::jsonb"))
    link_url: Mapped[str | None]
    starts_on: Mapped[date]
    ends_on: Mapped[date]
    enabled: Mapped[bool] = mapped_column(server_default=text("false"))

    __table_args__ = (
        CheckConstraint("template IN ('holiday', 'operation', 'event')", name="template"),
        CheckConstraint("starts_on <= ends_on", name="period"),
        Index("ix_popup_notices_active", "enabled", "starts_on", "ends_on"),
    )

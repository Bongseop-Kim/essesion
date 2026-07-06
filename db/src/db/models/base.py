"""모델 공통 기반.

- naming_convention으로 제약명을 고정한다 — alembic autogenerate 안정화의 전제.
  CheckConstraint는 **반드시 name을 지정**할 것 (`ck_<table>_<name>`으로 렌더링).
- updated_at은 onupdate(앱 레벨)로만 갱신된다 — 모든 쓰기가 SQLAlchemy(api) 경유
  전제이며 raw SQL UPDATE는 갱신하지 않는다. DB 트리거는 두지 않는다(기존 트리거
  로직은 api로 이동 — db/MAPPING.md).
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, MetaData, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    type_annotation_map = {
        str: Text(),
        dict[str, Any]: JSONB,
        datetime: DateTime(timezone=True),
    }


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))


class CreatedAtMixin:
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class TimestampMixin(CreatedAtMixin):
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

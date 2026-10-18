"""seamless 엔진 데이터 — 워커가 사용 (모티프 카탈로그·렌더 로그 기록).

motifs.id는 ingress별 prefix를 붙인 content-hash — ON CONFLICT DO NOTHING이 곧 멱등성.
"""

import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from db.models.base import Base, CreatedAtMixin, uuid_pk


class Motif(CreatedAtMixin, Base):
    __tablename__ = "motifs"

    id: Mapped[str] = mapped_column(primary_key=True)  # content-hash
    symbol: Mapped[str]
    # First generated-motif ingress provenance. Catalog reuse never rewrites these values;
    # account/session deletion nulls them instead of blocking privacy cleanup.
    ingested_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    ingested_session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("design_sessions.id", ondelete="SET NULL")
    )
    bbox: Mapped[dict[str, Any]]
    anchor: Mapped[dict[str, Any]]
    subject: Mapped[str | None]
    scope: Mapped[str | None]
    style: Mapped[str | None]
    source: Mapped[str]
    status: Mapped[str] = mapped_column(server_default="pending")

    __table_args__ = (
        CheckConstraint("scope IS NULL OR scope IN ('whole', 'partial')", name="scope"),
        CheckConstraint("status IN ('pending', 'approved', 'rejected')", name="status"),
    )


class SeamlessGenerationLog(CreatedAtMixin, Base):
    """/generate 요청당 1행 — admin 로그 뷰어 + SVG 재-export의 system of record."""

    __tablename__ = "seamless_generation_logs"

    id: Mapped[uuid.UUID] = uuid_pk()
    request_id: Mapped[str | None]
    # 요청자 링크 — API가 보낸 로그 표식(session_id/user_id)으로 워커가 채운다.
    # 탈퇴·세션 삭제는 SET NULL로 프라이버시 정리를 막지 않는다.
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("design_sessions.id", ondelete="SET NULL"), index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    input_type: Mapped[str]
    colorway: Mapped[str | None]
    seed: Mapped[int | None] = mapped_column(BigInteger)
    engine_version: Mapped[str | None]
    registry_version: Mapped[str | None]
    intent: Mapped[dict[str, Any] | None]
    # 생성 1회 = 디자인 1개 — 렌더 결과 스냅샷(id·svg·png_url·layout/colorway·seed).
    design: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    warnings: Mapped[list[Any]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    generate_ms: Mapped[Decimal | None]
    render_ms: Mapped[Decimal | None]
    status: Mapped[str] = mapped_column(server_default="success")
    error_type: Mapped[str | None]
    error_message: Mapped[str | None]
    diagnostics: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))

    __table_args__ = (
        CheckConstraint("input_type IN ('intent')", name="input_type"),
        CheckConstraint("status IN ('success', 'partial', 'error')", name="status"),
    )

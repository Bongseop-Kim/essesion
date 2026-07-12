"""seamless 엔진 데이터 — 워커가 사용 (motifs 검색·생성 로그 기록).

motifs.id는 content-hash(recraft-<sha256 12자>) — ON CONFLICT DO NOTHING이 곧 멱등성.
embedding은 vector(1536) 고정(OpenAI text-embedding-3-small) — 기존의 런타임
vector_dims 가드를 스키마 제약으로 대체. HNSW 인덱스는 두지 않는다(seq scan이
결정론적이고 현 규모에 충분 — 필요해지면 후속 리비전).
"""

import uuid
from decimal import Decimal
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Index, Text, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, REAL
from sqlalchemy.orm import Mapped, mapped_column

from db.models.base import Base, CreatedAtMixin, uuid_pk

EMBEDDING_DIM = 1536


class Motif(CreatedAtMixin, Base):
    __tablename__ = "motifs"

    id: Mapped[str] = mapped_column(primary_key=True)  # content-hash
    symbol: Mapped[str]
    color_slots: Mapped[list[Any]] = mapped_column(JSONB, server_default=text("'[\"s0\"]'::jsonb"))
    bbox: Mapped[dict[str, Any]]
    anchor: Mapped[dict[str, Any]]
    subject: Mapped[str | None]
    scope: Mapped[str | None]
    view: Mapped[str | None]
    expression: Mapped[str | None]
    style: Mapped[str | None]
    description: Mapped[str | None]
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=text("'{}'::text[]"))
    embedding: Mapped[Any | None] = mapped_column(Vector(EMBEDDING_DIM))
    source: Mapped[str] = mapped_column(server_default="recraft")
    quality: Mapped[float | None] = mapped_column(REAL)
    variant_group: Mapped[str | None]

    __table_args__ = (
        CheckConstraint("scope IS NULL OR scope IN ('whole', 'partial')", name="scope"),
    )


class SeamlessGenerationLog(CreatedAtMixin, Base):
    """/generate 요청당 1행 — admin 로그 뷰어 + SVG 재-export의 system of record."""

    __tablename__ = "seamless_generation_logs"

    id: Mapped[uuid.UUID] = uuid_pk()
    request_id: Mapped[str | None]
    input_type: Mapped[str]
    prompt: Mapped[str | None]
    has_reference_image: Mapped[bool] = mapped_column(server_default=text("false"))
    reference_image_bytes: Mapped[int | None]
    reference_image_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("images.id", ondelete="SET NULL")
    )
    colorway: Mapped[str | None]
    seed: Mapped[int | None] = mapped_column(BigInteger)
    candidate_count_requested: Mapped[int | None]
    candidate_count_returned: Mapped[int | None]
    distinct_layouts: Mapped[int | None]
    available_strategies: Mapped[int | None]
    engine_version: Mapped[str | None]
    registry_version: Mapped[str | None]
    intent: Mapped[dict[str, Any] | None]
    candidates: Mapped[list[Any] | None] = mapped_column(JSONB)
    warnings: Mapped[list[Any]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    generate_ms: Mapped[Decimal | None]
    render_ms: Mapped[Decimal | None]
    status: Mapped[str] = mapped_column(server_default="success")
    error_type: Mapped[str | None]
    error_message: Mapped[str | None]

    __table_args__ = (
        Index(
            "ix_seamless_generation_logs_reference_image_id",
            "reference_image_id",
            postgresql_where=text("reference_image_id IS NOT NULL"),
        ),
        CheckConstraint("input_type IN ('intent', 'prompt', 'reference_image')", name="input_type"),
        CheckConstraint("status IN ('success', 'partial', 'error')", name="status"),
    )

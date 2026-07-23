"""seamless 엔진 데이터 — 워커가 사용 (motifs 검색·생성 로그 기록).

motifs.id는 content-hash(recraft-<sha256 12자>) — ON CONFLICT DO NOTHING이 곧 멱등성.
임베딩은 Vertex AI gemini-embedding-001의 vector(3072)에 저장하며, 검색은
halfvec(3072) expression HNSW 인덱스를 사용한다.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    Text,
    literal_column,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, REAL
from sqlalchemy.orm import Mapped, mapped_column

from db.models.base import Base, CreatedAtMixin, TimestampMixin, uuid_pk

EMBEDDING_DIM = 3072
AUTHORING_EXAMPLE_FAMILIES = (
    "solid",
    "stripe",
    "lattice",
    "scatter",
    "path",
    "point_set",
    "stripe_motif",
    "multi_motif",
)


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
    embedding_vertex: Mapped[Any | None] = mapped_column(Vector(EMBEDDING_DIM))
    source: Mapped[str] = mapped_column(server_default="recraft")
    quality: Mapped[float | None] = mapped_column(REAL)
    variant_group: Mapped[str | None]

    __table_args__ = (
        CheckConstraint("scope IS NULL OR scope IN ('whole', 'partial')", name="scope"),
        Index(
            "ix_motifs_embedding_vertex_halfvec_hnsw",
            literal_column("(embedding_vertex::halfvec(3072))").label("embedding_vertex_halfvec"),
            postgresql_using="hnsw",
            postgresql_ops={"embedding_vertex_halfvec": "halfvec_cosine_ops"},
        ),
    )


class AuthoringExample(TimestampMixin, Base):
    """Approved Plan v3 example. Only active rows participate in RAG."""

    __tablename__ = "authoring_examples"

    id: Mapped[uuid.UUID] = uuid_pk()
    example_id: Mapped[str] = mapped_column(unique=True)
    source: Mapped[str] = mapped_column(server_default="bootstrap")
    contract_version: Mapped[int] = mapped_column(Integer)
    family: Mapped[str]
    motif_count: Mapped[int] = mapped_column(Integer)
    retrieval_text: Mapped[str]
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=text("'{}'::text[]"))
    plan: Mapped[dict[str, Any]] = mapped_column(JSONB)
    structural_fingerprint: Mapped[str]
    source_digest: Mapped[str]
    embedding_model: Mapped[str]
    embedding_vertex: Mapped[Any | None] = mapped_column(Vector(EMBEDDING_DIM))
    active: Mapped[bool] = mapped_column(server_default=text("false"))
    approved_at: Mapped[datetime | None]
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    active_updated_at: Mapped[datetime | None]
    active_updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    active_reason: Mapped[str | None]

    __table_args__ = (
        CheckConstraint("source IN ('bootstrap', 'promoted')", name="source"),
        CheckConstraint("contract_version > 0", name="contract_version_positive"),
        CheckConstraint("motif_count BETWEEN 0 AND 2", name="motif_count"),
        CheckConstraint(
            "family IN ('solid', 'stripe', 'lattice', 'scatter', 'path', "
            "'point_set', 'stripe_motif', 'multi_motif')",
            name="family",
        ),
        CheckConstraint(
            "NOT active OR (embedding_vertex IS NOT NULL AND approved_at IS NOT NULL)",
            name="active_ready",
        ),
        Index("ix_authoring_examples_active_family", "active", "family"),
        Index(
            "uq_authoring_examples_active_fingerprint",
            "structural_fingerprint",
            unique=True,
            postgresql_where=text("active"),
        ),
    )


class AuthoringPromotionCandidate(TimestampMixin, Base):
    """Rule-screened generation plan awaiting an administrator decision."""

    __tablename__ = "authoring_promotion_candidates"

    id: Mapped[uuid.UUID] = uuid_pk()
    source_key: Mapped[str] = mapped_column(unique=True)
    source_generation_log_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("seamless_generation_logs.id", ondelete="SET NULL"), index=True
    )
    plan_index: Mapped[int] = mapped_column(Integer)
    selected_candidate_id: Mapped[str]
    contract_version: Mapped[int] = mapped_column(Integer)
    compiler_revision: Mapped[str]
    prompt_revision: Mapped[str]
    family: Mapped[str]
    motif_count: Mapped[int] = mapped_column(Integer)
    retrieval_text: Mapped[str]
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=text("'{}'::text[]"))
    plan: Mapped[dict[str, Any]] = mapped_column(JSONB)
    structural_fingerprint: Mapped[str | None]
    source_digest: Mapped[str]
    embedding_model: Mapped[str | None]
    embedding_vertex: Mapped[Any | None] = mapped_column(Vector(EMBEDDING_DIM))
    nearest_kind: Mapped[str | None]
    nearest_id: Mapped[str | None]
    nearest_similarity: Mapped[float | None] = mapped_column(REAL)
    status: Mapped[str] = mapped_column(server_default="pending")
    rule_reasons: Mapped[list[Any]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    review_version: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    reviewed_at: Mapped[datetime | None]
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    review_reason: Mapped[str | None]
    approved_example_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("authoring_examples.id", ondelete="SET NULL"), unique=True
    )

    __table_args__ = (
        CheckConstraint("plan_index >= 0", name="plan_index"),
        CheckConstraint("contract_version > 0", name="contract_version_positive"),
        CheckConstraint("motif_count BETWEEN 0 AND 2", name="motif_count"),
        CheckConstraint(
            "family IN ('solid', 'stripe', 'lattice', 'scatter', 'path', "
            "'point_set', 'stripe_motif', 'multi_motif')",
            name="family",
        ),
        CheckConstraint(
            "status IN ('pending', 'hold', 'rejected', 'approved', 'duplicate', 'invalid')",
            name="status",
        ),
        CheckConstraint("review_version >= 0", name="review_version"),
        CheckConstraint(
            "nearest_similarity IS NULL OR nearest_similarity BETWEEN -1 AND 1",
            name="nearest_similarity",
        ),
        CheckConstraint(
            "status NOT IN ('pending', 'hold', 'approved') OR "
            "(embedding_model IS NOT NULL AND embedding_vertex IS NOT NULL "
            "AND structural_fingerprint IS NOT NULL)",
            name="reviewable_ready",
        ),
        Index("ix_authoring_promotion_candidates_status_created", "status", "created_at"),
        Index(
            "ix_authoring_promotion_candidates_fingerprint_status",
            "structural_fingerprint",
            "status",
        ),
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
    diagnostics: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))

    __table_args__ = (
        CheckConstraint("input_type IN ('intent', 'prompt', 'reference_image')", name="input_type"),
        CheckConstraint("status IN ('success', 'partial', 'error')", name="status"),
    )


class SeamlessGenerationAttachment(CreatedAtMixin, Base):
    """생성 로그에 전달된 참고 사진."""

    __tablename__ = "seamless_generation_attachments"

    id: Mapped[uuid.UUID] = uuid_pk()
    log_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("seamless_generation_logs.id", ondelete="CASCADE"), index=True
    )
    image_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("images.id", ondelete="CASCADE"), index=True
    )
    purpose: Mapped[str] = mapped_column(server_default="auto")
    ordinal: Mapped[int]

    __table_args__ = (
        CheckConstraint(
            "purpose IN ('auto', 'color_mood', 'motif', 'composition')", name="purpose"
        ),
        Index("uq_seamless_generation_attachments_log_ordinal", "log_id", "ordinal", unique=True),
    )

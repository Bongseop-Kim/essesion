"""replace revisioned examples with the active promotion pipeline"""

from collections.abc import Sequence

import pgvector.sqlalchemy
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d4e5f6a7b8c9"
down_revision: str | None = "c3d4e5f6a7b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_FAMILIES = (
    "'solid', 'stripe', 'lattice', 'scatter', 'path', 'point_set', 'stripe_motif', 'multi_motif'"
)


def _create_active_examples() -> None:
    op.create_table(
        "authoring_examples",
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("example_id", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), server_default="bootstrap", nullable=False),
        sa.Column("contract_version", sa.Integer(), nullable=False),
        sa.Column("family", sa.Text(), nullable=False),
        sa.Column("motif_count", sa.Integer(), nullable=False),
        sa.Column("retrieval_text", sa.Text(), nullable=False),
        sa.Column(
            "tags", sa.ARRAY(sa.Text()), server_default=sa.text("'{}'::text[]"), nullable=False
        ),
        sa.Column("plan", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("structural_fingerprint", sa.Text(), nullable=False),
        sa.Column("source_digest", sa.Text(), nullable=False),
        sa.Column("embedding_model", sa.Text(), nullable=False),
        sa.Column("embedding_vertex", pgvector.sqlalchemy.Vector(dim=3072), nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by", sa.Uuid(), nullable=True),
        sa.Column("active_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("active_updated_by", sa.Uuid(), nullable=True),
        sa.Column("active_reason", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "source IN ('bootstrap', 'promoted')",
            name=op.f("ck_authoring_examples_source"),
        ),
        sa.CheckConstraint(
            "contract_version > 0", name=op.f("ck_authoring_examples_contract_version_positive")
        ),
        sa.CheckConstraint(
            "motif_count BETWEEN 0 AND 2", name=op.f("ck_authoring_examples_motif_count")
        ),
        sa.CheckConstraint(
            f"family IN ({_FAMILIES})",
            name=op.f("ck_authoring_examples_family"),
        ),
        sa.CheckConstraint(
            "NOT active OR (embedding_vertex IS NOT NULL AND approved_at IS NOT NULL)",
            name=op.f("ck_authoring_examples_active_ready"),
        ),
        sa.ForeignKeyConstraint(
            ["approved_by"],
            ["users.id"],
            name=op.f("fk_authoring_examples_approved_by_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["active_updated_by"],
            ["users.id"],
            name=op.f("fk_authoring_examples_active_updated_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_authoring_examples")),
        sa.UniqueConstraint("example_id", name=op.f("uq_authoring_examples_example_id")),
    )
    op.create_index(
        "ix_authoring_examples_active_family",
        "authoring_examples",
        ["active", "family"],
        unique=False,
    )
    op.create_index(
        "uq_authoring_examples_active_fingerprint",
        "authoring_examples",
        ["structural_fingerprint"],
        unique=True,
        postgresql_where=sa.text("active"),
    )


def _create_candidates() -> None:
    op.create_table(
        "authoring_promotion_candidates",
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("source_key", sa.Text(), nullable=False),
        sa.Column("source_generation_log_id", sa.Uuid(), nullable=True),
        sa.Column("plan_index", sa.Integer(), nullable=False),
        sa.Column("selected_candidate_id", sa.Text(), nullable=False),
        sa.Column("contract_version", sa.Integer(), nullable=False),
        sa.Column("compiler_revision", sa.Text(), nullable=False),
        sa.Column("prompt_revision", sa.Text(), nullable=False),
        sa.Column("family", sa.Text(), nullable=False),
        sa.Column("motif_count", sa.Integer(), nullable=False),
        sa.Column("retrieval_text", sa.Text(), nullable=False),
        sa.Column(
            "tags", sa.ARRAY(sa.Text()), server_default=sa.text("'{}'::text[]"), nullable=False
        ),
        sa.Column("plan", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("structural_fingerprint", sa.Text(), nullable=True),
        sa.Column("source_digest", sa.Text(), nullable=False),
        sa.Column("embedding_model", sa.Text(), nullable=True),
        sa.Column("embedding_vertex", pgvector.sqlalchemy.Vector(dim=3072), nullable=True),
        sa.Column("nearest_kind", sa.Text(), nullable=True),
        sa.Column("nearest_id", sa.Text(), nullable=True),
        sa.Column("nearest_similarity", sa.REAL(), nullable=True),
        sa.Column("status", sa.Text(), server_default="pending", nullable=False),
        sa.Column(
            "rule_reasons",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("review_version", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", sa.Uuid(), nullable=True),
        sa.Column("review_reason", sa.Text(), nullable=True),
        sa.Column("approved_example_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "plan_index >= 0", name=op.f("ck_authoring_promotion_candidates_plan_index")
        ),
        sa.CheckConstraint(
            "contract_version > 0",
            name=op.f("ck_authoring_promotion_candidates_contract_version_positive"),
        ),
        sa.CheckConstraint(
            "motif_count BETWEEN 0 AND 2",
            name=op.f("ck_authoring_promotion_candidates_motif_count"),
        ),
        sa.CheckConstraint(
            f"family IN ({_FAMILIES})",
            name=op.f("ck_authoring_promotion_candidates_family"),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'hold', 'rejected', 'approved', 'duplicate', 'invalid')",
            name=op.f("ck_authoring_promotion_candidates_status"),
        ),
        sa.CheckConstraint(
            "review_version >= 0",
            name=op.f("ck_authoring_promotion_candidates_review_version"),
        ),
        sa.CheckConstraint(
            "nearest_similarity IS NULL OR nearest_similarity BETWEEN -1 AND 1",
            name=op.f("ck_authoring_promotion_candidates_nearest_similarity"),
        ),
        sa.CheckConstraint(
            "status NOT IN ('pending', 'hold', 'approved') OR "
            "(embedding_model IS NOT NULL AND embedding_vertex IS NOT NULL "
            "AND structural_fingerprint IS NOT NULL)",
            name=op.f("ck_authoring_promotion_candidates_reviewable_ready"),
        ),
        sa.ForeignKeyConstraint(
            ["source_generation_log_id"],
            ["seamless_generation_logs.id"],
            name=op.f(
                "fk_authoring_promotion_candidates_source_generation_log_id_seamless_generation_logs"
            ),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by"],
            ["users.id"],
            name=op.f("fk_authoring_promotion_candidates_reviewed_by_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["approved_example_id"],
            ["authoring_examples.id"],
            name=op.f("fk_authoring_promotion_candidates_approved_example_id_authoring_examples"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_authoring_promotion_candidates")),
        sa.UniqueConstraint(
            "source_key", name=op.f("uq_authoring_promotion_candidates_source_key")
        ),
        sa.UniqueConstraint(
            "approved_example_id",
            name=op.f("uq_authoring_promotion_candidates_approved_example_id"),
        ),
    )
    op.create_index(
        "ix_authoring_promotion_candidates_source_generation_log_id",
        "authoring_promotion_candidates",
        ["source_generation_log_id"],
        unique=False,
    )
    op.create_index(
        "ix_authoring_promotion_candidates_status_created",
        "authoring_promotion_candidates",
        ["status", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_authoring_promotion_candidates_fingerprint_status",
        "authoring_promotion_candidates",
        ["structural_fingerprint", "status"],
        unique=False,
    )


def _create_legacy_examples() -> None:
    op.create_table(
        "authoring_examples",
        sa.Column("example_set_revision", sa.Text(), nullable=False),
        sa.Column("example_id", sa.Text(), nullable=False),
        sa.Column("contract_version", sa.Integer(), nullable=False),
        sa.Column("family", sa.Text(), nullable=False),
        sa.Column("motif_count", sa.Integer(), nullable=False),
        sa.Column("retrieval_text", sa.Text(), nullable=False),
        sa.Column(
            "tags", sa.ARRAY(sa.Text()), server_default=sa.text("'{}'::text[]"), nullable=False
        ),
        sa.Column("plan", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("source_digest", sa.Text(), nullable=False),
        sa.Column("embedding_model", sa.Text(), nullable=False),
        sa.Column("embedding_vertex", pgvector.sqlalchemy.Vector(dim=3072), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "contract_version > 0", name=op.f("ck_authoring_examples_contract_version_positive")
        ),
        sa.CheckConstraint(
            "motif_count BETWEEN 0 AND 2", name=op.f("ck_authoring_examples_motif_count")
        ),
        sa.CheckConstraint(
            f"family IN ({_FAMILIES})",
            name=op.f("ck_authoring_examples_family"),
        ),
        sa.PrimaryKeyConstraint(
            "example_set_revision", "example_id", name=op.f("pk_authoring_examples")
        ),
    )
    op.create_index(
        "ix_authoring_examples_set_family",
        "authoring_examples",
        ["example_set_revision", "family"],
        unique=False,
    )


def upgrade() -> None:
    # 개발 단계의 revision 기반 로컬 예시는 보존하지 않는다. bootstrap sync가
    # 승인된 25개 예시와 embedding을 최종 스키마에 다시 투영한다.
    op.drop_index("ix_authoring_examples_set_family", table_name="authoring_examples")
    op.drop_table("authoring_examples")
    _create_active_examples()
    _create_candidates()
    op.execute(
        """
        INSERT INTO admin_settings (key, value)
        VALUES
            ('authoring_pipeline_mode', 'legacy'),
            ('authoring_shadow_percent', '5'),
            ('authoring_canary_percent', '10')
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM admin_settings WHERE key IN "
        "('authoring_pipeline_mode', 'authoring_shadow_percent', 'authoring_canary_percent')"
    )
    op.drop_index(
        "ix_authoring_promotion_candidates_fingerprint_status",
        table_name="authoring_promotion_candidates",
    )
    op.drop_index(
        "ix_authoring_promotion_candidates_status_created",
        table_name="authoring_promotion_candidates",
    )
    op.drop_index(
        "ix_authoring_promotion_candidates_source_generation_log_id",
        table_name="authoring_promotion_candidates",
    )
    op.drop_table("authoring_promotion_candidates")
    op.drop_index("uq_authoring_examples_active_fingerprint", table_name="authoring_examples")
    op.drop_index("ix_authoring_examples_active_family", table_name="authoring_examples")
    op.drop_table("authoring_examples")
    _create_legacy_examples()

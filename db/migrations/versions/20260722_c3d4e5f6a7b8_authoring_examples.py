"""add immutable authoring example retrieval projection"""

from collections.abc import Sequence

import pgvector.sqlalchemy
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c3d4e5f6a7b8"
down_revision: str | None = "9b7c6d5e4f3a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
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
            "family IN ('solid', 'stripe', 'lattice', 'scatter', 'path', 'point_set', 'stripe_motif', 'multi_motif')",
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


def downgrade() -> None:
    op.drop_index("ix_authoring_examples_set_family", table_name="authoring_examples")
    op.drop_table("authoring_examples")

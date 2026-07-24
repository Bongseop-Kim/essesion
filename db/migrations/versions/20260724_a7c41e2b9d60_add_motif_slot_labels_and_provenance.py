"""add motif slot labels and ingress provenance

Revision ID: a7c41e2b9d60
Revises: 8ce7aff0df59
Create Date: 2026-07-24 22:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a7c41e2b9d60"
down_revision: str | None = "8ce7aff0df59"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "motifs",
        sa.Column(
            "slot_labels",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.add_column("motifs", sa.Column("ingested_user_id", sa.Uuid(), nullable=True))
    op.add_column("motifs", sa.Column("ingested_session_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_motifs_ingested_user_id_users"),
        "motifs",
        "users",
        ["ingested_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        op.f("fk_motifs_ingested_session_id_design_sessions"),
        "motifs",
        "design_sessions",
        ["ingested_session_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_motifs_ingested_session_id_design_sessions"),
        "motifs",
        type_="foreignkey",
    )
    op.drop_constraint(
        op.f("fk_motifs_ingested_user_id_users"),
        "motifs",
        type_="foreignkey",
    )
    op.drop_column("motifs", "ingested_session_id")
    op.drop_column("motifs", "ingested_user_id")
    op.drop_column("motifs", "slot_labels")

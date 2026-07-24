"""add design conversation state

Revision ID: 6fd0b0217a44
Revises: a7c41e2b9d60
Create Date: 2026-07-24 23:40:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "6fd0b0217a44"
down_revision: str | None = "a7c41e2b9d60"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "design_sessions",
        sa.Column(
            "current_plan",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.add_column(
        "design_sessions",
        sa.Column(
            "context_version",
            sa.BigInteger(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )
    op.add_column(
        "design_sessions",
        sa.Column("active_generation_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "design_sessions",
        sa.Column(
            "active_generation_started_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.create_check_constraint(
        op.f("ck_design_sessions_context_version"),
        "design_sessions",
        "context_version >= 0",
    )
    op.create_check_constraint(
        op.f("ck_design_sessions_active_generation_pair"),
        "design_sessions",
        "(active_generation_id IS NULL) = (active_generation_started_at IS NULL)",
    )
    op.create_check_constraint(
        op.f("ck_design_session_turns_role"),
        "design_session_turns",
        "role IN ('user', 'assistant')",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_design_session_turns_role"),
        "design_session_turns",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_design_sessions_active_generation_pair"),
        "design_sessions",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_design_sessions_context_version"),
        "design_sessions",
        type_="check",
    )
    op.drop_column("design_sessions", "active_generation_started_at")
    op.drop_column("design_sessions", "active_generation_id")
    op.drop_column("design_sessions", "context_version")
    op.drop_column("design_sessions", "current_plan")

"""refresh token session kind

Revision ID: 4c8f6a1e2b3d
Revises: b0db3ad0771c
Create Date: 2026-07-12 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "4c8f6a1e2b3d"
down_revision: str | None = "b0db3ad0771c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "refresh_tokens",
        sa.Column("session_kind", sa.Text(), server_default=sa.text("'store'"), nullable=False),
    )
    op.create_check_constraint(
        op.f("ck_refresh_tokens_session_kind"),
        "refresh_tokens",
        "session_kind IN ('store', 'admin')",
    )
    op.create_index(
        "ix_refresh_tokens_user_id_session_kind",
        "refresh_tokens",
        ["user_id", "session_kind"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_refresh_tokens_user_id_session_kind", table_name="refresh_tokens")
    op.drop_constraint(op.f("ck_refresh_tokens_session_kind"), "refresh_tokens", type_="check")
    op.drop_column("refresh_tokens", "session_kind")

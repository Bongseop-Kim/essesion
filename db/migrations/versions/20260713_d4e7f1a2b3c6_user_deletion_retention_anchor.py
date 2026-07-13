"""add user deletion retention anchor

Revision ID: d4e7f1a2b3c6
Revises: 9b7e5d3c1a20
Create Date: 2026-07-13 20:45:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4e7f1a2b3c6"
down_revision: str | None = "9b7e5d3c1a20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "deleted_at")

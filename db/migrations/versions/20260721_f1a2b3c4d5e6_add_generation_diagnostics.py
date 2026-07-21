"""add generation diagnostics

Revision ID: f1a2b3c4d5e6
Revises: e7f9a1b2c3d4
Create Date: 2026-07-21 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f1a2b3c4d5e6"
down_revision: str | None = "e7f9a1b2c3d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "seamless_generation_logs",
        sa.Column(
            "diagnostics",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("seamless_generation_logs", "diagnostics")

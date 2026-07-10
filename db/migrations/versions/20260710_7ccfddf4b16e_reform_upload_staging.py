"""reform upload staging

Revision ID: 7ccfddf4b16e
Revises: a658f96021f4
Create Date: 2026-07-10 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7ccfddf4b16e"
down_revision: str | None = "a658f96021f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("images", sa.Column("claim_token_hash", sa.Text(), nullable=True))
    op.add_column("images", sa.Column("content_type", sa.Text(), nullable=True))
    op.add_column("images", sa.Column("size_bytes", sa.Integer(), nullable=True))
    op.add_column(
        "images", sa.Column("upload_completed_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("images", "upload_completed_at")
    op.drop_column("images", "size_bytes")
    op.drop_column("images", "content_type")
    op.drop_column("images", "claim_token_hash")

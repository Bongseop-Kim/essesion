"""add phone verification attempt lockout

Revision ID: 9b7e5d3c1a20
Revises: f18a6c2d9b40
Create Date: 2026-07-13 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "9b7e5d3c1a20"
down_revision: str | None = "f18a6c2d9b40"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "phone_verifications",
        sa.Column("failed_attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "phone_verifications",
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        op.f("ck_phone_verifications_failed_attempts_nonnegative"),
        "phone_verifications",
        "failed_attempts >= 0",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_phone_verifications_failed_attempts_nonnegative"),
        "phone_verifications",
        type_="check",
    )
    op.drop_column("phone_verifications", "locked_at")
    op.drop_column("phone_verifications", "failed_attempts")

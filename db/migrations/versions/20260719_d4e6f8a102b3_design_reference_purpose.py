"""record per-photo design reference purpose

Revision ID: d4e6f8a102b3
Revises: a31b5c7d9e02
Create Date: 2026-07-19 21:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4e6f8a102b3"
down_revision: str | None = "a31b5c7d9e02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_PURPOSE_CHECK = "purpose IN ('auto', 'color_mood', 'motif', 'composition')"


def upgrade() -> None:
    op.add_column(
        "design_turn_attachments",
        sa.Column("purpose", sa.Text(), nullable=True),
    )
    op.execute("UPDATE design_turn_attachments SET purpose = 'auto' WHERE kind = 'photo'")
    op.create_check_constraint(
        op.f("ck_design_turn_attachments_purpose"),
        "design_turn_attachments",
        f"(kind = 'photo' AND purpose IS NOT NULL AND {_PURPOSE_CHECK}) "
        "OR (kind = 'svg' AND purpose IS NULL)",
    )

    op.add_column(
        "seamless_generation_attachments",
        sa.Column("purpose", sa.Text(), server_default="auto", nullable=False),
    )
    op.create_check_constraint(
        op.f("ck_seamless_generation_attachments_purpose"),
        "seamless_generation_attachments",
        _PURPOSE_CHECK,
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_seamless_generation_attachments_purpose"),
        "seamless_generation_attachments",
        type_="check",
    )
    op.drop_column("seamless_generation_attachments", "purpose")
    op.drop_constraint(
        op.f("ck_design_turn_attachments_purpose"),
        "design_turn_attachments",
        type_="check",
    )
    op.drop_column("design_turn_attachments", "purpose")

"""manual orders

Revision ID: 90f1f66cc27b
Revises: d4e7f1a2b3c6
Create Date: 2026-07-15 12:00:02.399828

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "90f1f66cc27b"
down_revision: str | None = "d4e7f1a2b3c6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "manual_orders",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("order_date", sa.Date(), nullable=False),
        sa.Column("customer_name", sa.Text(), nullable=False),
        sa.Column("phone", sa.Text(), nullable=False),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("shipping_fee", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("is_received", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("is_paid", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("is_confirmed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "items",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("amount >= 0", name=op.f("ck_manual_orders_amount")),
        sa.CheckConstraint("shipping_fee >= 0", name=op.f("ck_manual_orders_shipping_fee")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_manual_orders")),
    )
    op.create_index(
        "ix_manual_orders_admin_list", "manual_orders", ["order_date", "id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_manual_orders_admin_list", table_name="manual_orders")
    op.drop_table("manual_orders")

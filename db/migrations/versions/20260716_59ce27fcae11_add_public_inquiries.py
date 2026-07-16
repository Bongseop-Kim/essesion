"""add public inquiries

Revision ID: 59ce27fcae11
Revises: 90f1f66cc27b
Create Date: 2026-07-16 11:13:43.484061

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "59ce27fcae11"
down_revision: str | None = "90f1f66cc27b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "inquiries",
        sa.Column("is_secret", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    op.drop_constraint(op.f("ck_inquiries_category"), "inquiries", type_="check")
    op.create_check_constraint(
        op.f("ck_inquiries_category"),
        "inquiries",
        "category IN ('일반', '상품', '수선', '주문제작', '샘플제작')",
    )
    op.create_index(op.f("ix_inquiries_product_id"), "inquiries", ["product_id"], unique=False)
    op.create_index(
        "ix_inquiries_public_list",
        "inquiries",
        ["category", "created_at", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_inquiries_public_list", table_name="inquiries")
    op.drop_index(op.f("ix_inquiries_product_id"), table_name="inquiries")
    op.drop_constraint(op.f("ck_inquiries_category"), "inquiries", type_="check")
    op.create_check_constraint(
        op.f("ck_inquiries_category"),
        "inquiries",
        "category IN ('일반', '상품', '수선', '주문제작')",
    )
    op.drop_column("inquiries", "is_secret")

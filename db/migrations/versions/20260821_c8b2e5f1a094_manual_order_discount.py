"""manual_orders.discount 컬럼 추가

Revision ID: c8b2e5f1a094
Revises: a3f7d94c1e28
Create Date: 2026-08-21 00:00:00.000000

전화·무통장 접수에서 깎아준 금액을 기록할 곳이 없어 `amount`에 미리 깎은 값을 적는
편법밖에 없었다. `amount`는 원금 그대로 두고 `discount`를 기본 0으로 추가한다 — 기존 행의
매출 합계(`amount - discount + shipping_fee`)가 그대로 유지되는 유일한 방법이다.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c8b2e5f1a094"
down_revision: str | None = "a3f7d94c1e28"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "manual_orders",
        sa.Column("discount", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    # 이름은 naming_convention이 ck_manual_orders_<name>으로 확장한다 — 모델과 같게 bare name.
    op.create_check_constraint("discount", "manual_orders", "discount >= 0")
    op.create_check_constraint("discount_within_amount", "manual_orders", "discount <= amount")


def downgrade() -> None:
    op.drop_constraint("ck_manual_orders_discount_within_amount", "manual_orders")
    op.drop_constraint("ck_manual_orders_discount", "manual_orders")
    op.drop_column("manual_orders", "discount")

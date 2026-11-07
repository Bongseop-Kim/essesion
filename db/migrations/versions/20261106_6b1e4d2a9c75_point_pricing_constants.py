"""포인트(자수·열전사 필름) 가격 상수 행 추가

Revision ID: 6b1e4d2a9c75
Revises: 1edfb81ae618
Create Date: 2026-11-06 00:00:00.000000

맞춤 주문에 포인트 옵션(자수·열전사 필름)이 생겼다. 맞춤 주문 가격 계산은 이 두 키가 없으면
`pricing_not_configured`로 죽으므로, 수동 `seed-config`를 기다리지 않고 기존 DB에도 행을 넣는다
(`on conflict do nothing` — a3f7d94c1e28 선례). 값의 정본은 `config_defaults.py`·`money.md`.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "6b1e4d2a9c75"
down_revision: str | None = "1edfb81ae618"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "insert into pricing_constants (key, amount, category) values "
        "('EMBROIDERY_COST', 5000, 'custom_order'), "
        "('HEAT_TRANSFER_COST', 3000, 'custom_order') "
        "on conflict (key) do nothing"
    )


def downgrade() -> None:
    op.execute(
        "delete from pricing_constants where key in ('EMBROIDERY_COST', 'HEAT_TRANSFER_COST')"
    )

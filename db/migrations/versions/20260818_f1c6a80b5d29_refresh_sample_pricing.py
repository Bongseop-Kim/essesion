"""샘플비 3키를 money.md §3·§4 값으로 갱신

Revision ID: f1c6a80b5d29
Revises: d4e9a71c3b58
Create Date: 2026-08-18 00:00:00.000000

`seed-config`는 운영에서 overwrite=False로 돌기 때문에(운영자가 화면에서 조정한 값을
되돌리면 안 된다) 이미 존재하는 pricing_constants 행의 금액은 절대 바뀌지 않는다.
샘플비는 커밋 a028415에서 정가가 바뀌었으므로 기존 운영 행은 이 마이그레이션으로만
따라온다. 없는 행은 seed-config가 새 값으로 채우므로 여기서는 UPDATE만 한다.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "f1c6a80b5d29"
down_revision: str | None = "d4e9a71c3b58"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# key: (신규 정가, 이전 정가)
_SAMPLE_PRICES = {
    "SAMPLE_SEWING_COST": (100000, 50000),
    "SAMPLE_FABRIC_PRINTING_COST": (100000, 60000),
    "SAMPLE_FABRIC_YARN_DYED_COST": (200000, 80000),
}


def _apply(index: int) -> None:
    for key, amounts in _SAMPLE_PRICES.items():
        op.execute(f"update pricing_constants set amount = {amounts[index]} where key = '{key}'")


def upgrade() -> None:
    _apply(0)


def downgrade() -> None:
    _apply(1)

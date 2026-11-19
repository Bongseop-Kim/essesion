"""견적 요청 최소 수량 100 → 4

Revision ID: 9a4c7e1d5b20
Revises: 6b1e4d2a9c75
Create Date: 2026-11-18 00:00:00.000000

스토어가 수량과 무관하게 견적하기를 두면서 견적 하한을 주문 제작 최소 수량(4개)과 맞춘다.
api의 검증(quotes/service.py)과 같은 값이다 — 계약은 `docs/api-spec/domains.md`.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "9a4c7e1d5b20"
down_revision: str | None = "6b1e4d2a9c75"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_quote_requests_quantity", "quote_requests")
    op.create_check_constraint("quantity", "quote_requests", "quantity >= 4")


def downgrade() -> None:
    op.drop_constraint("ck_quote_requests_quantity", "quote_requests")
    # 그사이 접수된 100개 미만 견적이 있으면 검증에 걸리므로 기존 행은 검사하지 않는다.
    op.create_check_constraint(
        "quantity", "quote_requests", "quantity >= 100", postgresql_not_valid=True
    )

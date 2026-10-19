"""design_examples 템플릿 데이터 컬럼 + design_sessions.example_id

Revision ID: 7c2e9a4f1b63
Revises: 16d24e91da59
Create Date: 2026-10-14 10:00:00.000000

템플릿은 시드 코드가 정본이고 DB는 store로 전달하는 자리다(`docs/reviews/design-template-first-flow-2026-10-13.md`
2026-10-14 결정). 컬럼은 전부 null 허용·기본값이라 기존 행은 올패턴·분류 없음으로 읽힌다.
세션의 example_id는 색·로고 페이지가 포인트 위치·로고 슬롯을 템플릿에서 읽기 위한 포인터다.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7c2e9a4f1b63"
down_revision: str | None = "16d24e91da59"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("design_examples", sa.Column("category", sa.Text(), nullable=True))
    op.add_column(
        "design_examples",
        sa.Column("point", sa.Text(), server_default="none", nullable=False),
    )
    op.add_column("design_examples", sa.Column("logo_slot", sa.Integer(), nullable=True))
    op.add_column("design_examples", sa.Column("photo_full_url", sa.Text(), nullable=True))
    op.add_column("design_examples", sa.Column("photo_detail_url", sa.Text(), nullable=True))
    op.create_check_constraint(
        op.f("ck_design_examples_point"),
        "design_examples",
        "point IN ('none', 'top', 'bottom')",
    )
    op.create_check_constraint(
        op.f("ck_design_examples_logo_slot"), "design_examples", "logo_slot IN (1, 2)"
    )
    op.add_column("design_sessions", sa.Column("example_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_design_sessions_example_id_design_examples"),
        "design_sessions",
        "design_examples",
        ["example_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_design_sessions_example_id_design_examples"),
        "design_sessions",
        type_="foreignkey",
    )
    op.drop_column("design_sessions", "example_id")
    op.drop_constraint(op.f("ck_design_examples_logo_slot"), "design_examples", type_="check")
    op.drop_constraint(op.f("ck_design_examples_point"), "design_examples", type_="check")
    op.drop_column("design_examples", "photo_detail_url")
    op.drop_column("design_examples", "photo_full_url")
    op.drop_column("design_examples", "logo_slot")
    op.drop_column("design_examples", "point")
    op.drop_column("design_examples", "category")

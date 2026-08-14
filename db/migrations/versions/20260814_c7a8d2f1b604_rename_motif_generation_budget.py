"""design session 모티프 생성 예산 컬럼 이름 보정

Revision ID: c7a8d2f1b604
Revises: b9e4f61a2c73
Create Date: 2026-08-14 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c7a8d2f1b604"
down_revision: str | None = "b9e4f61a2c73"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _column_names() -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns("design_sessions")}


def _check_names() -> set[str]:
    return {
        constraint["name"]
        for constraint in sa.inspect(op.get_bind()).get_check_constraints("design_sessions")
        if constraint["name"] is not None
    }


def upgrade() -> None:
    columns = _column_names()
    if "motif_generation_used" not in columns:
        if "recraft_used" in columns:
            op.alter_column(
                "design_sessions",
                "recraft_used",
                new_column_name="motif_generation_used",
            )
        else:
            op.add_column(
                "design_sessions",
                sa.Column(
                    "motif_generation_used",
                    sa.Integer(),
                    server_default=sa.text("0"),
                    nullable=False,
                ),
            )

    checks = _check_names()
    if "ck_design_sessions_recraft_used" in checks:
        op.drop_constraint(
            op.f("ck_design_sessions_recraft_used"),
            "design_sessions",
            type_="check",
        )
    if "ck_design_sessions_motif_generation_used" not in checks:
        op.create_check_constraint(
            op.f("ck_design_sessions_motif_generation_used"),
            "design_sessions",
            "motif_generation_used >= 0",
        )


def downgrade() -> None:
    # b9e4f61a2c73의 baseline은 이미 motif_generation_used를 선언한다. 이 revision은
    # 과거 b9 적용 DB만 recraft_used로 남은 migration-history drift를 전진 보정하므로,
    # downgrade에서도 현재 b9 스키마와 맞는 보정 결과를 유지한다.
    pass

"""finalize quota window

Revision ID: c4d1a9f27e83
Revises: b852f8135ae2
Create Date: 2026-07-19 10:20:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4d1a9f27e83"
down_revision: str | None = "b852f8135ae2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # finalize 제한이 세션당 예산에서 계정당 24시간 윈도우 쿼터(generation_jobs 카운트)로
    # 바뀐다 — 세션 카운터·건당 환불은 폐기 (docs/api-spec/worker-pipeline.md §5).
    op.drop_constraint("finalize_used", "design_sessions", type_="check")
    op.drop_column("design_sessions", "finalize_used")
    # 계정 쿼터 카운트 쿼리용 — POST finalize·GET 세션마다 돈다
    op.create_index(
        "ix_generation_jobs_user_kind_created",
        "generation_jobs",
        ["user_id", "kind", "created_at"],
        unique=False,
    )
    op.execute(
        """
        INSERT INTO admin_settings (key, value)
        VALUES ('design_finalize_daily_limit', '10')
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM admin_settings WHERE key = 'design_finalize_daily_limit'")
    op.drop_index("ix_generation_jobs_user_kind_created", table_name="generation_jobs")
    # 세션별 사용량은 복구 불가 — 전 세션 0으로 리셋된다.
    op.add_column(
        "design_sessions",
        sa.Column("finalize_used", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.create_check_constraint("finalize_used", "design_sessions", "finalize_used >= 0")

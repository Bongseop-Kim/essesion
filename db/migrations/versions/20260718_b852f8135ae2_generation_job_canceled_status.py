"""generation job canceled status

Revision ID: b852f8135ae2
Revises: 2c0b39f58ea3
Create Date: 2026-07-18 21:28:20.517015

"""

from collections.abc import Sequence

from alembic import op

revision: str = "b852f8135ae2"
down_revision: str | None = "2c0b39f58ea3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # naming_convention이 ck_generation_jobs_ 프리픽스를 붙인다 — 원명("status")만 지정
    op.drop_constraint("status", "generation_jobs", type_="check")
    op.create_check_constraint(
        "status",
        "generation_jobs",
        "status IN ('queued', 'processing', 'succeeded', 'failed', 'canceled')",
    )


def downgrade() -> None:
    # canceled는 구 스키마에 없다 — 환불은 이미 이뤄졌으므로 failed(시간 초과 메시지)로 강등
    op.execute(
        "UPDATE generation_jobs"
        " SET status = 'failed',"
        "     error_message = COALESCE(error_message, 'finalize 작업 처리 시간이 초과되었습니다')"
        " WHERE status = 'canceled'"
    )
    op.drop_constraint("status", "generation_jobs", type_="check")
    op.create_check_constraint(
        "status",
        "generation_jobs",
        "status IN ('queued', 'processing', 'succeeded', 'failed')",
    )

"""token_works 추가 — 미완료 차감 기록(프로세스 중단 복구의 대조 근거)

Revision ID: b7f4c2e18d05
Revises: e6b3d15a9c47
Create Date: 2026-09-08 00:00:00.000000

모티프 생성·실사화는 토큰을 먼저 차감하고 외부 호출에 들어간다. 차감 원장만으로는 그
호출이 결과를 남겼는지 판별할 수 없어서, 차감과 같은 트랜잭션에 pending 기록을 남기고
기한이 지난 pending을 복구 배치가 정확히 한 번 환불한다 (money.md §6).

user_id는 CASCADE가 아니다 — 탈퇴가 미완료 과금 증거를 지우지 않는다(원장과 같은 규칙).
downgrade는 표를 지운다 — 남은 pending을 먼저 복구한 뒤에만 내릴 것.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7f4c2e18d05"
down_revision: str | None = "e6b3d15a9c47"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "token_works",
        sa.Column("work_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), server_default="pending", nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result_id", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(status = 'pending') = (finished_at IS NULL)",
            name=op.f("ck_token_works_finished_at_pair"),
        ),
        sa.CheckConstraint(
            "kind IN ('motif_generate', 'design_finalize')", name=op.f("ck_token_works_kind")
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'succeeded', 'refunded')", name=op.f("ck_token_works_status")
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_token_works_user_id_users")),
        sa.PrimaryKeyConstraint("work_id", name=op.f("pk_token_works")),
    )
    op.create_index(
        "ix_token_works_pending_deadline",
        "token_works",
        ["deadline_at"],
        unique=False,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(op.f("ix_token_works_user_id"), "token_works", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_token_works_user_id"), table_name="token_works")
    op.drop_index(
        "ix_token_works_pending_deadline",
        table_name="token_works",
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.drop_table("token_works")

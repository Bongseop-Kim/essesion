"""design_sessions.motif_generation_used 드랍 — 세션당 모티프 생성 상한 제거

Revision ID: d4e9a71c3b58
Revises: c7a8d2f1b604
Create Date: 2026-08-17 00:00:00.000000

상한이 사라져 읽는 코드가 없다. 근거는
docs/reviews/motif-generation-session-cap-removed-2026-08-17.md.
downgrade는 컬럼과 CHECK만 되살린다 — 과거 사용 횟수는 복원할 수 없다(0에서 다시 센다).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4e9a71c3b58"
down_revision: str | None = "c7a8d2f1b604"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(
        op.f("ck_design_sessions_motif_generation_used"), "design_sessions", type_="check"
    )
    op.drop_column("design_sessions", "motif_generation_used")


def downgrade() -> None:
    op.add_column(
        "design_sessions",
        sa.Column(
            "motif_generation_used",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.create_check_constraint(
        op.f("ck_design_sessions_motif_generation_used"),
        "design_sessions",
        "motif_generation_used >= 0",
    )

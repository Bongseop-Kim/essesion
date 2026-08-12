"""motifs.view/expression 제거 — 비전 태깅 메타데이터 축으로 단순화

Revision ID: b9e4f61a2c73
Revises: a4d9c1e57b02
Create Date: 2026-08-12 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b9e4f61a2c73"
down_revision: str | None = "a4d9c1e57b02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("motifs", "expression")
    op.drop_column("motifs", "view")


def downgrade() -> None:
    op.add_column("motifs", sa.Column("view", sa.Text(), nullable=True))
    op.add_column("motifs", sa.Column("expression", sa.Text(), nullable=True))

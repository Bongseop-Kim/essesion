"""relate seamless generation logs to private reference images

Revision ID: f18a6c2d9b40
Revises: e93a2f71c4d5
Create Date: 2026-07-12 15:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f18a6c2d9b40"
down_revision: str | None = "e93a2f71c4d5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 과거 로그에는 Image 관계가 없으므로 nullable로 시작한다. 이후 이관 또는 새 writer가
    # entity_type='seamless_generation', entity_id=<log UUID>와 함께 채우는 계약이다.
    op.add_column(
        "seamless_generation_logs",
        sa.Column("reference_image_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        op.f("fk_seamless_generation_logs_reference_image_id_images"),
        "seamless_generation_logs",
        "images",
        ["reference_image_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_seamless_generation_logs_reference_image_id",
        "seamless_generation_logs",
        ["reference_image_id"],
        unique=False,
        postgresql_where=sa.text("reference_image_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_seamless_generation_logs_reference_image_id",
        table_name="seamless_generation_logs",
    )
    op.drop_constraint(
        op.f("fk_seamless_generation_logs_reference_image_id_images"),
        "seamless_generation_logs",
        type_="foreignkey",
    )
    op.drop_column("seamless_generation_logs", "reference_image_id")

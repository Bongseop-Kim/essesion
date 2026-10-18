"""design_examples.logo_slot → logo_slots (템플릿마다 로고 여러 자리)

Revision ID: 3d8a51c7e2f4
Revises: 7c2e9a4f1b63
Create Date: 2026-10-18 10:00:00.000000

템플릿이 로고를 몇 개, 어느 슬롯에 받을지 목록으로 둔다 — [{slot: 1|2|"logo", label}].
정본은 여전히 시드 코드라 기존 값만 한 자리 목록으로 옮기고, 시드 재실행이 라벨·추가 자리를 채운다.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "3d8a51c7e2f4"
down_revision: str | None = "7c2e9a4f1b63"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("design_examples", sa.Column("logo_slots", JSONB(), nullable=True))
    op.execute(
        "UPDATE design_examples SET logo_slots = jsonb_build_array(jsonb_build_object("
        "'slot', logo_slot, 'label', '로고')) WHERE logo_slot IS NOT NULL"
    )
    op.drop_constraint(op.f("ck_design_examples_logo_slot"), "design_examples", type_="check")
    op.drop_column("design_examples", "logo_slot")


def downgrade() -> None:
    op.add_column("design_examples", sa.Column("logo_slot", sa.Integer(), nullable=True))
    op.execute(
        "UPDATE design_examples SET logo_slot = (logo_slots->0->>'slot')::int "
        "WHERE logo_slots->0->>'slot' IN ('1', '2')"
    )
    op.create_check_constraint(
        op.f("ck_design_examples_logo_slot"), "design_examples", "logo_slot IN (1, 2)"
    )
    op.drop_column("design_examples", "logo_slots")

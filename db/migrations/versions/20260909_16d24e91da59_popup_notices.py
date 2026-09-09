"""popup_notices 추가 — store 첫 진입 팝업 공지(템플릿 3종, 기간 노출)

Revision ID: 16d24e91da59
Revises: b7f4c2e18d05
Create Date: 2026-09-09 16:57:46.109029

운영자가 배포 없이 기간 한정 안내(명절 휴무·배송 정책·이벤트)를 올리고 내리기 위한 표다.
템플릿별 필드는 `fields` JSONB에 두고 api가 검증한다(`docs/reviews/store-popup-notice-2026-09-09.md`).
데이터 이관은 없다 — 기존 팝업이 없었다. downgrade는 표를 지운다.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "16d24e91da59"
down_revision: str | None = "b7f4c2e18d05"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "popup_notices",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("template", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("title_emphasis", sa.Text(), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column(
            "fields",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("link_url", sa.Text(), nullable=True),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "template IN ('holiday', 'operation', 'event')", name=op.f("ck_popup_notices_template")
        ),
        sa.CheckConstraint("starts_on <= ends_on", name=op.f("ck_popup_notices_period")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_popup_notices")),
    )
    op.create_index(
        "ix_popup_notices_active",
        "popup_notices",
        ["enabled", "starts_on", "ends_on"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_popup_notices_active", table_name="popup_notices")
    op.drop_table("popup_notices")

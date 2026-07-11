"""order shipping address snapshot

Revision ID: b0db3ad0771c
Revises: 7ccfddf4b16e
Create Date: 2026-07-11 18:01:45.374481
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "b0db3ad0771c"
down_revision: str | None = "7ccfddf4b16e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("shipping_address_snapshot", JSONB(), nullable=True))
    # 기존 주문 백필 — 현재 라이브 조인과 동일한 값이므로 손실 없음.
    # 이미 주소가 삭제된(SET NULL) 주문은 복원할 원본이 없어 NULL로 남는다.
    op.execute(
        """
        UPDATE orders o
        SET shipping_address_snapshot = jsonb_build_object(
            'id', sa.id,
            'recipient_name', sa.recipient_name,
            'recipient_phone', sa.recipient_phone,
            'postal_code', sa.postal_code,
            'address', sa.address,
            'address_detail', sa.address_detail,
            'delivery_memo', sa.delivery_memo,
            'delivery_request', sa.delivery_request
        )
        FROM shipping_addresses sa
        WHERE o.shipping_address_id = sa.id
          AND o.shipping_address_snapshot IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column("orders", "shipping_address_snapshot")

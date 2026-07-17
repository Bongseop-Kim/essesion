"""backfill order item product snapshot

Revision ID: c7d2e94a5b18
Revises: eaac110cb362
Create Date: 2026-07-17 12:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c7d2e94a5b18"
down_revision: str | None = "eaac110cb362"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 주문 생성 서비스(_deduct_stock)가 남기는 item_data.product/option 스냅샷이 없는
    # 레거시 product 주문을 현재 products/product_options 값으로 best-effort 백필한다.
    # 이미 상품이 삭제된 주문은 복원할 원본이 없어 그대로 남는다.
    op.execute(
        """
        UPDATE order_items oi
        SET item_data = COALESCE(oi.item_data, '{}'::jsonb) || jsonb_build_object(
            'product', jsonb_build_object(
                'id', p.id,
                'code', p.code,
                'name', p.name,
                'image', p.image,
                'category', p.category
            ),
            'option', COALESCE(
                (
                    SELECT jsonb_build_object(
                        'id', po.id::text,
                        'name', po.name,
                        'additional_price', po.additional_price
                    )
                    FROM product_options po
                    WHERE po.product_id = p.id
                      AND po.id::text = lower(oi.selected_option_id)
                ),
                'null'::jsonb
            )
        )
        FROM products p
        WHERE oi.item_type = 'product'
          AND oi.product_id = p.id
          AND (oi.item_data IS NULL OR NOT oi.item_data ? 'product')
        """
    )


def downgrade() -> None:
    # 데이터 백필 전용 — 백필된 행과 서비스가 기록한 행을 구분할 수 없어 되돌리지 않는다.
    pass

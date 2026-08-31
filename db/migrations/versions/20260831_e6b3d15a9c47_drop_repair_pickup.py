"""수선 방문 수거 제거 — 고객이 항상 직접 택배로 발송한다

Revision ID: e6b3d15a9c47
Revises: c8b2e5f1a094
Create Date: 2026-08-31 00:00:00.000000

방문 수거는 기사 배차·일정 관리가 감당되지 않아 제공을 중단한다(운영 결정 2026-08-31).
'수거예정'은 "고객이 물건을 보내기 전" 상태라는 점에서 '발송대기'와 같으므로 그쪽으로
이관하고, 수거 요청 테이블과 수거비 가격 상수를 지운다.

과거 pickup 주문의 수거비 스냅샷은 repair_pickup_requests에만 있어 drop과 함께 사라진다 —
그 금액은 orders.total_price에 이미 합산돼 결제 총액·환불액은 보존되지만, admin 금액 분해
(원금 − 할인 + 배송비)는 과거 pickup 주문에서 total_price와 어긋난다(의도된 손실).
order_status_logs의 '수거예정' 문자열은 감사 추적이므로 그대로 남긴다(제약 없음).

downgrade는 테이블·상태값·가격 상수를 되살리지만 삭제된 수거 요청 행은 복원하지 않는다.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e6b3d15a9c47"
down_revision: str | None = "c8b2e5f1a094"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STATUSES = (
    "'대기중', '결제중', '진행중', '배송중', '배송완료', '완료', '취소', '실패', '접수', "
    "'제작중', '제작완료', '수선중', '수선완료', '발송대기', '발송중', '발송확인중'"
)


def upgrade() -> None:
    op.execute("UPDATE orders SET status = '발송대기' WHERE status = '수거예정'")
    op.drop_constraint("ck_orders_status", "orders")
    op.create_check_constraint("status", "orders", f"status IN ({STATUSES})")
    op.drop_table("repair_pickup_requests")
    op.execute("DELETE FROM pricing_constants WHERE key = 'REFORM_PICKUP_FEE'")


def downgrade() -> None:
    op.drop_constraint("ck_orders_status", "orders")
    op.create_check_constraint("status", "orders", f"status IN ({STATUSES}, '수거예정')")
    op.create_table(
        "repair_pickup_requests",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("recipient_name", sa.Text(), nullable=False),
        sa.Column("recipient_phone", sa.Text(), nullable=False),
        sa.Column("postal_code", sa.Text(), nullable=True),
        sa.Column("address", sa.Text(), nullable=False),
        sa.Column("detail_address", sa.Text(), nullable=True),
        sa.Column("pickup_fee", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("pickup_fee >= 0", name=op.f("ck_repair_pickup_requests_pickup_fee")),
        sa.ForeignKeyConstraint(
            ["order_id"], ["orders.id"], name=op.f("fk_repair_pickup_requests_order_id_orders")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_repair_pickup_requests")),
        sa.UniqueConstraint("order_id", name=op.f("uq_repair_pickup_requests_order_id")),
    )
    op.execute(
        "INSERT INTO pricing_constants (key, amount, category) "
        "VALUES ('REFORM_PICKUP_FEE', 5000, 'reform') ON CONFLICT (key) DO NOTHING"
    )

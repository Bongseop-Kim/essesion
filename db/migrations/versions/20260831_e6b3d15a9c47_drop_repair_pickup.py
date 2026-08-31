"""수선 방문 수거 제거 — 고객이 항상 직접 택배로 발송한다

Revision ID: e6b3d15a9c47
Revises: c8b2e5f1a094
Create Date: 2026-08-31 00:00:00.000000

방문 수거는 기사 배차·일정 관리가 감당되지 않아 제공을 중단한다(운영 결정 2026-08-31).
'수거예정'은 "고객이 물건을 보내기 전" 상태라는 점에서 '발송대기'와 같으므로 그쪽으로
이관하고, 수거 요청 테이블과 수거비 가격 상수를 지운다. 상태 변환은 감사 로그에 남겨
이후 접수 롤백 근거를 보존한다.

과거 수거비는 orders.shipping_cost에 합쳐 금액 분해를 보존하고 total_price는 바꾸지 않는다.
이미 결제된 수거비는 기존 partial_cancel 대사 queue에 올려 provider 환불·크레딧 정산을
운영자가 완료하도록 하며, pickup_fee는 incident details의 감사 스냅샷으로 남긴다.

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
    op.execute(
        "INSERT INTO order_status_logs "
        "(order_id, changed_by, previous_status, new_status, memo, is_rollback, request_id) "
        "SELECT id, NULL, '수거예정', '발송대기', "
        "'마이그레이션: 방문 수거 종료', false, 'migration:e6b3d15a9c47' "
        "FROM orders WHERE status = '수거예정'"
    )
    op.execute("UPDATE orders SET status = '발송대기' WHERE status = '수거예정'")
    op.execute(
        "INSERT INTO payment_incidents "
        "(operation_id, type, status, request_id, actor_id, order_id, claim_id, "
        "expected_amount, observed_amount, details) "
        "SELECT 'repair-pickup-removal:' || orders.id::text, 'partial_cancel', 'open', "
        "'migration:e6b3d15a9c47', NULL, orders.id, NULL, orders.total_price, NULL, "
        "jsonb_build_object("
        "'phase', 'legacy_repair_pickup_refund_pending', "
        "'pickup_fee', repair_pickup_requests.pickup_fee, "
        "'policy_effective_date', '2026-08-31', "
        "'lookup_payment_key', orders.payment_key) "
        "FROM repair_pickup_requests "
        "JOIN orders ON orders.id = repair_pickup_requests.order_id "
        "WHERE orders.paid_at IS NOT NULL AND repair_pickup_requests.pickup_fee > 0 "
        "ON CONFLICT (operation_id) DO NOTHING"
    )
    op.execute(
        "UPDATE orders SET shipping_cost = orders.shipping_cost + pickup.pickup_fee "
        "FROM repair_pickup_requests AS pickup WHERE orders.id = pickup.order_id"
    )
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

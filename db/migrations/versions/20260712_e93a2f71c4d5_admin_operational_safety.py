"""admin operational safety foundations

Revision ID: e93a2f71c4d5
Revises: 4c8f6a1e2b3d
Create Date: 2026-07-12 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e93a2f71c4d5"
down_revision: str | None = "4c8f6a1e2b3d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table_name in (
        "order_status_logs",
        "claim_status_logs",
        "quote_request_status_logs",
    ):
        op.add_column(table_name, sa.Column("request_id", sa.Text(), nullable=True))

    # 상품 옵션은 ID를 보존한 diff update가 가능하도록 수정 시각과 DB 제약을 둔다.
    op.add_column(
        "product_options",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_unique_constraint(
        op.f("uq_product_options_product_id_name"),
        "product_options",
        ["product_id", "name"],
    )
    op.create_check_constraint(
        op.f("ck_product_options_additional_price"),
        "product_options",
        "additional_price >= 0",
    )

    # 이미 발급된 쿠폰의 금전 의미가 template 수정으로 바뀌지 않게 한다.
    op.add_column(
        "user_coupons",
        sa.Column("terms_snapshot", postgresql.JSONB(), nullable=True),
    )
    op.execute(
        """
        UPDATE user_coupons uc
        SET terms_snapshot = jsonb_build_object(
            'name', c.name,
            'display_name', c.display_name,
            'discount_type', c.discount_type,
            'discount_value', c.discount_value,
            'max_discount_amount', c.max_discount_amount,
            'description', c.description,
            'expiry_date', c.expiry_date,
            'additional_info', c.additional_info
        )
        FROM coupons c
        WHERE uc.coupon_id = c.id
          AND uc.terms_snapshot IS NULL
        """
    )

    # 견적도 주문과 동일하게 생성 시점 배송지를 보존한다.
    op.add_column(
        "quote_requests",
        sa.Column("shipping_address_snapshot", postgresql.JSONB(), nullable=True),
    )
    op.execute(
        """
        UPDATE quote_requests qr
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
        WHERE qr.shipping_address_id = sa.id
          AND qr.shipping_address_snapshot IS NULL
        """
    )
    op.drop_constraint(
        op.f("fk_quote_requests_shipping_address_id_shipping_addresses"),
        "quote_requests",
        type_="foreignkey",
    )
    op.alter_column(
        "quote_requests",
        "shipping_address_id",
        existing_type=sa.Uuid(),
        nullable=True,
    )
    op.create_foreign_key(
        op.f("fk_quote_requests_shipping_address_id_shipping_addresses"),
        "quote_requests",
        "shipping_addresses",
        ["shipping_address_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # 기존 row는 성공 전송 뒤에만 기록됐으므로 sent로 보정한다.
    op.add_column(
        "claim_notification_logs",
        sa.Column(
            "delivery_status",
            sa.Text(),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
    )
    op.add_column(
        "claim_notification_logs",
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "claim_notification_logs",
        sa.Column("last_error", sa.Text(), nullable=True),
    )
    op.add_column(
        "claim_notification_logs",
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "claim_notification_logs",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.execute(
        """
        UPDATE claim_notification_logs
        SET delivery_status = 'sent', attempts = 1, sent_at = created_at
        """
    )
    op.create_check_constraint(
        op.f("ck_claim_notification_logs_delivery_status"),
        "claim_notification_logs",
        "delivery_status IN ('pending', 'sent', 'failed', 'skipped')",
    )
    op.create_check_constraint(
        op.f("ck_claim_notification_logs_attempts"),
        "claim_notification_logs",
        "attempts >= 0",
    )
    op.create_index(
        "ix_claim_notification_logs_delivery",
        "claim_notification_logs",
        ["delivery_status", "created_at"],
        unique=False,
    )

    op.add_column("inquiries", sa.Column("answered_by", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_inquiries_answered_by_users"),
        "inquiries",
        "users",
        ["answered_by"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "admin_operation_logs",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("operation_id", sa.Text(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("target_type", sa.Text(), nullable=False),
        sa.Column("target_id", sa.Text(), nullable=True),
        sa.Column("target_count", sa.Integer(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("before", postgresql.JSONB(), nullable=True),
        sa.Column("after", postgresql.JSONB(), nullable=True),
        sa.Column("request_id", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "target_count IS NULL OR target_count >= 0",
            name=op.f("ck_admin_operation_logs_target_count"),
        ),
        sa.ForeignKeyConstraint(
            ["actor_id"],
            ["users.id"],
            name=op.f("fk_admin_operation_logs_actor_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_admin_operation_logs")),
        sa.UniqueConstraint("operation_id", name=op.f("uq_admin_operation_logs_operation_id")),
    )
    op.create_index(
        op.f("ix_admin_operation_logs_actor_id"),
        "admin_operation_logs",
        ["actor_id"],
        unique=False,
    )
    op.create_index(
        "ix_admin_operation_logs_created_at",
        "admin_operation_logs",
        ["created_at", "id"],
        unique=False,
    )

    op.create_table(
        "payment_incidents",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("operation_id", sa.Text(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), server_default=sa.text("'open'"), nullable=False),
        sa.Column("request_id", sa.Text(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("order_id", sa.Uuid(), nullable=True),
        sa.Column("claim_id", sa.Uuid(), nullable=True),
        sa.Column("expected_amount", sa.Integer(), nullable=True),
        sa.Column("observed_amount", sa.Integer(), nullable=True),
        sa.Column(
            "details",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("resolution_memo", sa.Text(), nullable=True),
        sa.Column("resolved_by", sa.Uuid(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
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
            "type IN ('confirm', 'refund', 'partial_cancel', 'mixed_state', 'amount_mismatch')",
            name=op.f("ck_payment_incidents_type"),
        ),
        sa.CheckConstraint(
            "status IN ('open', 'resolved')",
            name=op.f("ck_payment_incidents_status"),
        ),
        sa.CheckConstraint(
            "expected_amount IS NULL OR expected_amount >= 0",
            name=op.f("ck_payment_incidents_expected_amount"),
        ),
        sa.CheckConstraint(
            "observed_amount IS NULL OR observed_amount >= 0",
            name=op.f("ck_payment_incidents_observed_amount"),
        ),
        sa.ForeignKeyConstraint(
            ["actor_id"],
            ["users.id"],
            name=op.f("fk_payment_incidents_actor_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["claim_id"],
            ["claims.id"],
            name=op.f("fk_payment_incidents_claim_id_claims"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["order_id"],
            ["orders.id"],
            name=op.f("fk_payment_incidents_order_id_orders"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["resolved_by"],
            ["users.id"],
            name=op.f("fk_payment_incidents_resolved_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_payment_incidents")),
        sa.UniqueConstraint("operation_id", name=op.f("uq_payment_incidents_operation_id")),
    )
    op.create_index(
        "ix_payment_incidents_queue",
        "payment_incidents",
        ["status", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_payment_incidents_order_id",
        "payment_incidents",
        ["order_id"],
        unique=False,
    )
    op.create_index(
        "ix_payment_incidents_claim_id",
        "payment_incidents",
        ["claim_id"],
        unique=False,
    )

    for table_name, columns in (
        ("products", ["category", "created_at", "id"]),
        ("coupons", ["is_active", "expiry_date", "id"]),
        ("orders", ["status", "order_type", "created_at", "id"]),
        ("claims", ["status", "type", "created_at", "id"]),
        ("inquiries", ["status", "created_at", "id"]),
        ("quote_requests", ["status", "created_at", "id"]),
    ):
        op.create_index(f"ix_{table_name}_admin_list", table_name, columns, unique=False)

    # Fresh DB와 기존 DB 모두 typed 설정 allowlist의 필수 row를 갖는다.
    op.execute(
        """
        INSERT INTO admin_settings (key, value)
        VALUES
            ('default_courier_company', '롯데택배'),
            ('design_token_initial_grant', '30')
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    for table_name in (
        "quote_requests",
        "inquiries",
        "claims",
        "orders",
        "coupons",
        "products",
    ):
        op.drop_index(f"ix_{table_name}_admin_list", table_name=table_name)

    op.drop_index("ix_payment_incidents_claim_id", table_name="payment_incidents")
    op.drop_index("ix_payment_incidents_order_id", table_name="payment_incidents")
    op.drop_index("ix_payment_incidents_queue", table_name="payment_incidents")
    op.drop_table("payment_incidents")

    op.drop_index("ix_admin_operation_logs_created_at", table_name="admin_operation_logs")
    op.drop_index(op.f("ix_admin_operation_logs_actor_id"), table_name="admin_operation_logs")
    op.drop_table("admin_operation_logs")

    op.drop_constraint(
        op.f("fk_inquiries_answered_by_users"),
        "inquiries",
        type_="foreignkey",
    )
    op.drop_column("inquiries", "answered_by")

    op.drop_index(
        "ix_claim_notification_logs_delivery",
        table_name="claim_notification_logs",
    )
    op.drop_constraint(
        op.f("ck_claim_notification_logs_attempts"),
        "claim_notification_logs",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_claim_notification_logs_delivery_status"),
        "claim_notification_logs",
        type_="check",
    )
    op.drop_column("claim_notification_logs", "updated_at")
    op.drop_column("claim_notification_logs", "sent_at")
    op.drop_column("claim_notification_logs", "last_error")
    op.drop_column("claim_notification_logs", "attempts")
    op.drop_column("claim_notification_logs", "delivery_status")

    op.drop_constraint(
        op.f("fk_quote_requests_shipping_address_id_shipping_addresses"),
        "quote_requests",
        type_="foreignkey",
    )
    op.alter_column(
        "quote_requests",
        "shipping_address_id",
        existing_type=sa.Uuid(),
        nullable=False,
    )
    op.create_foreign_key(
        op.f("fk_quote_requests_shipping_address_id_shipping_addresses"),
        "quote_requests",
        "shipping_addresses",
        ["shipping_address_id"],
        ["id"],
    )
    op.drop_column("quote_requests", "shipping_address_snapshot")

    op.drop_column("user_coupons", "terms_snapshot")

    op.drop_constraint(
        op.f("ck_product_options_additional_price"),
        "product_options",
        type_="check",
    )
    op.drop_constraint(
        op.f("uq_product_options_product_id_name"),
        "product_options",
        type_="unique",
    )
    op.drop_column("product_options", "updated_at")

    for table_name in (
        "quote_request_status_logs",
        "claim_status_logs",
        "order_status_logs",
    ):
        op.drop_column(table_name, "request_id")

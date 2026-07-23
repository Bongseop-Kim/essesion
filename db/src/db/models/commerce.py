"""커머스 도메인 — 기존 구조·상태값(한국어 text+CHECK) 보존, FK만 users로 재지정.

정리 원칙 (MAPPING.md §1):
- 유저 소유 임시 데이터(배송지·장바구니·찜)는 ondelete CASCADE,
  돈·이력 데이터(주문·클레임·견적)는 NO ACTION — 탈퇴는 api가 명시 처리.
- 채번(ORD|CLM|QUO-YYYYMMDD-NNN)·상태 전이·집계는 api 소유(unique 제약만 DB).
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Identity,
    Index,
    Numeric,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from db.models.base import Base, CreatedAtMixin, TimestampMixin, uuid_pk


class ShippingAddress(CreatedAtMixin, Base):
    __tablename__ = "shipping_addresses"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    recipient_name: Mapped[str]
    recipient_phone: Mapped[str]
    postal_code: Mapped[str]
    address: Mapped[str]
    address_detail: Mapped[str | None]
    is_default: Mapped[bool]
    delivery_memo: Mapped[str | None]
    delivery_request: Mapped[str | None]


class Product(TimestampMixin, Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    code: Mapped[str | None] = mapped_column(unique=True)  # 채번({3F|SF|KN|BT}-...)은 api
    name: Mapped[str]
    price: Mapped[int]
    image: Mapped[str]
    category: Mapped[str]
    color: Mapped[str]
    pattern: Mapped[str]
    material: Mapped[str]
    info: Mapped[str]
    detail_images: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    stock: Mapped[int | None]  # null = 무제한
    option_label: Mapped[str | None]

    __table_args__ = (
        CheckConstraint("price >= 0", name="price"),
        CheckConstraint("stock IS NULL OR stock >= 0", name="stock"),
        CheckConstraint("category IN ('3fold', 'sfolderato', 'knit', 'bowtie')", name="category"),
        CheckConstraint(
            "color IN ('black', 'navy', 'gray', 'wine', 'blue', 'brown', 'beige', 'silver')",
            name="color",
        ),
        CheckConstraint(
            "pattern IN ('solid', 'stripe', 'dot', 'check', 'paisley')", name="pattern"
        ),
        CheckConstraint("material IN ('silk', 'cotton', 'polyester', 'wool')", name="material"),
        Index("ix_products_admin_list", "category", "created_at", "id"),
    )


class ProductOption(TimestampMixin, Base):
    __tablename__ = "product_options"

    id: Mapped[uuid.UUID] = uuid_pk()
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str]
    additional_price: Mapped[int] = mapped_column(server_default=text("0"))
    stock: Mapped[int | None]

    __table_args__ = (
        UniqueConstraint("product_id", "name"),
        CheckConstraint("additional_price >= 0", name="additional_price"),
        CheckConstraint("stock IS NULL OR stock >= 0", name="stock"),
    )


class ProductLike(CreatedAtMixin, Base):
    """좋아요 수는 집계 테이블(구 product_like_counts) 없이 COUNT 쿼리로 계산."""

    __tablename__ = "product_likes"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), index=True
    )

    __table_args__ = (UniqueConstraint("user_id", "product_id"),)


class Coupon(TimestampMixin, Base):
    __tablename__ = "coupons"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(unique=True)
    display_name: Mapped[str | None]
    discount_type: Mapped[str]
    discount_value: Mapped[Decimal] = mapped_column(Numeric)
    max_discount_amount: Mapped[Decimal | None] = mapped_column(Numeric)
    description: Mapped[str | None]
    expiry_date: Mapped[date]
    additional_info: Mapped[str | None]
    is_active: Mapped[bool] = mapped_column(server_default=text("true"))

    __table_args__ = (
        CheckConstraint("discount_type IN ('percentage', 'fixed')", name="discount_type"),
        CheckConstraint("discount_value > 0", name="discount_value"),
        Index("ix_coupons_admin_list", "is_active", "expiry_date", "id"),
    )


class UserCoupon(TimestampMixin, Base):
    __tablename__ = "user_coupons"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    coupon_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("coupons.id"))
    status: Mapped[str] = mapped_column(server_default="active")
    issued_at: Mapped[datetime] = mapped_column(server_default=text("now()"))
    expires_at: Mapped[datetime | None]
    used_at: Mapped[datetime | None]
    # 발급 시점의 표시명·할인 조건.
    terms_snapshot: Mapped[dict[str, Any]]

    __table_args__ = (
        UniqueConstraint("user_id", "coupon_id"),
        CheckConstraint(
            "status IN ('active', 'used', 'expired', 'revoked', 'reserved')", name="status"
        ),
    )


class CartItem(TimestampMixin, Base):
    __tablename__ = "cart_items"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    item_id: Mapped[str]  # 클라이언트 합성 키 (product:{id}:{option} / reform uuid)
    item_type: Mapped[str]
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"))
    selected_option_id: Mapped[str | None]
    reform_data: Mapped[dict[str, Any] | None]
    quantity: Mapped[int]
    applied_user_coupon_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user_coupons.id", ondelete="SET NULL")
    )

    __table_args__ = (
        UniqueConstraint("user_id", "item_id"),
        CheckConstraint("item_type IN ('product', 'reform')", name="item_type"),
        CheckConstraint("quantity > 0", name="quantity"),
    )


class Order(TimestampMixin, Base):
    __tablename__ = "orders"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    order_number: Mapped[str] = mapped_column(unique=True)  # ORD|TKN-YYYYMMDD-NNN — 채번은 api
    order_type: Mapped[str] = mapped_column(server_default="sale")
    status: Mapped[str] = mapped_column(server_default="대기중")
    shipping_address_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("shipping_addresses.id", ondelete="SET NULL")
    )
    # 주문 시점 배송지 스냅샷 — 주소 수정/삭제가 과거 주문 표시에 반영되지 않도록 보존
    shipping_address_snapshot: Mapped[dict[str, Any] | None]
    total_price: Mapped[int]
    original_price: Mapped[int]
    total_discount: Mapped[int] = mapped_column(server_default=text("0"))
    shipping_cost: Mapped[int] = mapped_column(server_default=text("0"))
    payment_group_id: Mapped[uuid.UUID | None] = mapped_column(index=True)  # 묶음 결제 단위
    payment_key: Mapped[str | None]  # Toss paymentKey
    courier_company: Mapped[str | None]
    tracking_number: Mapped[str | None]
    shipped_at: Mapped[datetime | None]
    delivered_at: Mapped[datetime | None]
    confirmed_at: Mapped[datetime | None]
    company_courier_company: Mapped[str | None]  # 수선: 회사→고객 발송 송장
    company_tracking_number: Mapped[str | None]
    company_shipped_at: Mapped[datetime | None]

    __table_args__ = (
        CheckConstraint(
            "order_type IN ('sale', 'custom', 'repair', 'token', 'sample')", name="order_type"
        ),
        CheckConstraint(
            "status IN ('대기중', '결제중', '진행중', '배송중', '배송완료', '완료', '취소', "
            "'실패', '접수', '제작중', '제작완료', '수선중', '수선완료', '발송대기', '발송중', "
            "'발송확인중', '수거예정')",
            name="status",
        ),
        CheckConstraint("total_price >= 0", name="total_price"),
        CheckConstraint("original_price >= 0", name="original_price"),
        CheckConstraint("total_discount >= 0", name="total_discount"),
        CheckConstraint("shipping_cost >= 0", name="shipping_cost"),
        # 스케줄러(배송완료 자동확정 / 배송중 확인 / stale 대기중 취소) 스캔용 부분 인덱스
        Index(
            "ix_orders_pending_confirmation",
            "delivered_at",
            postgresql_where=text("status = '배송완료'"),
        ),
        Index(
            "ix_orders_pending_confirm_shipping",
            "shipped_at",
            postgresql_where=text("status = '배송중'"),
        ),
        Index(
            "ix_orders_stale_pending_created_at",
            "created_at",
            postgresql_where=text("status = '대기중'"),
        ),
        Index("ix_orders_admin_list", "status", "order_type", "created_at", "id"),
    )


class OrderItem(CreatedAtMixin, Base):
    __tablename__ = "order_items"

    id: Mapped[uuid.UUID] = uuid_pk()
    order_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), index=True
    )
    item_id: Mapped[str]
    item_type: Mapped[str]
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"))
    selected_option_id: Mapped[str | None]
    item_data: Mapped[dict[str, Any]] = mapped_column(
        server_default=text("'{}'::jsonb")
    )  # 주문 시점 스냅샷 — product/option 포함 전 타입
    quantity: Mapped[int]
    unit_price: Mapped[int]
    discount_amount: Mapped[int] = mapped_column(server_default=text("0"))
    line_discount_amount: Mapped[int] = mapped_column(server_default=text("0"))
    applied_user_coupon_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user_coupons.id", ondelete="SET NULL")
    )

    __table_args__ = (
        CheckConstraint(
            "item_type IN ('product', 'reform', 'custom', 'token', 'sample')", name="item_type"
        ),
        CheckConstraint("quantity > 0", name="quantity"),
        CheckConstraint("unit_price >= 0", name="unit_price"),
        CheckConstraint("discount_amount >= 0", name="discount_amount"),
        CheckConstraint("line_discount_amount >= 0", name="line_discount_amount"),
    )


class Review(TimestampMixin, Base):
    __tablename__ = "reviews"

    id: Mapped[uuid.UUID] = uuid_pk()
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))
    order_item_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("order_items.id", ondelete="CASCADE")
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    order_type: Mapped[str]
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), index=True
    )
    rating: Mapped[int]
    content: Mapped[str]
    # 공개 assets 버킷 object_key 목록 [{"object_key": str}] — 표시 순서 보존
    photos: Mapped[list[Any]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))

    __table_args__ = (
        UniqueConstraint(
            "order_id",
            "order_item_id",
            name="uq_reviews_order_item",
            postgresql_nulls_not_distinct=True,
        ),
        CheckConstraint("order_type IN ('sale', 'repair', 'custom', 'sample')", name="order_type"),
        CheckConstraint("rating BETWEEN 1 AND 5", name="rating"),
        CheckConstraint("char_length(content) BETWEEN 1 AND 1000", name="content_length"),
        Index("ix_reviews_public_list", "order_type", "created_at", "id"),
    )


class OrderStatusLog(CreatedAtMixin, Base):
    __tablename__ = "order_status_logs"

    id: Mapped[uuid.UUID] = uuid_pk()
    order_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), index=True
    )
    changed_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    previous_status: Mapped[str]
    new_status: Mapped[str]
    memo: Mapped[str | None]
    is_rollback: Mapped[bool] = mapped_column(server_default=text("false"))
    request_id: Mapped[str | None]


class Claim(TimestampMixin, Base):
    __tablename__ = "claims"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"))
    order_item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("order_items.id"))
    claim_number: Mapped[str] = mapped_column(unique=True)  # CLM-YYYYMMDD-NNN — 채번은 api
    type: Mapped[str]
    status: Mapped[str] = mapped_column(server_default="접수")
    reason: Mapped[str]
    description: Mapped[str | None]
    quantity: Mapped[int]
    return_courier_company: Mapped[str | None]
    return_tracking_number: Mapped[str | None]
    resend_courier_company: Mapped[str | None]
    resend_tracking_number: Mapped[str | None]
    refund_data: Mapped[dict[str, Any] | None]

    __table_args__ = (
        CheckConstraint("type IN ('cancel', 'return', 'exchange', 'token_refund')", name="type"),
        CheckConstraint(
            "status IN ('접수', '처리중', '수거요청', '수거완료', '재발송', '완료', '거부')",
            name="status",
        ),
        CheckConstraint("quantity > 0", name="quantity"),
        # 아이템·타입당 활성(거부 제외) 클레임 1개
        Index(
            "uq_claims_active_per_item",
            "order_item_id",
            "type",
            unique=True,
            postgresql_where=text(
                "status IN ('접수', '처리중', '수거요청', '수거완료', '재발송', '완료')"
            ),
        ),
        # 주문당 진행 중(완료·거부 제외) 클레임 1개
        Index(
            "uq_claims_single_active_per_order",
            "order_id",
            unique=True,
            postgresql_where=text("status IN ('접수', '처리중', '수거요청', '수거완료', '재발송')"),
        ),
        Index("ix_claims_admin_list", "status", "type", "created_at", "id"),
    )


class ClaimStatusLog(CreatedAtMixin, Base):
    __tablename__ = "claim_status_logs"

    id: Mapped[uuid.UUID] = uuid_pk()
    claim_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("claims.id", ondelete="CASCADE"), index=True
    )
    changed_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    previous_status: Mapped[str]
    new_status: Mapped[str]
    memo: Mapped[str | None]
    is_rollback: Mapped[bool] = mapped_column(server_default=text("false"))
    request_id: Mapped[str | None]


class ClaimNotificationLog(TimestampMixin, Base):
    __tablename__ = "claim_notification_logs"

    id: Mapped[uuid.UUID] = uuid_pk()
    claim_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("claims.id", ondelete="CASCADE"))
    status: Mapped[str]
    delivery_status: Mapped[str] = mapped_column(server_default="pending")
    attempts: Mapped[int] = mapped_column(server_default=text("0"))
    last_error: Mapped[str | None]
    sent_at: Mapped[datetime | None]

    __table_args__ = (
        UniqueConstraint("claim_id", "status"),
        CheckConstraint(
            "delivery_status IN ('pending', 'sent', 'failed', 'skipped')",
            name="delivery_status",
        ),
        CheckConstraint("attempts >= 0", name="attempts"),
        Index("ix_claim_notification_logs_delivery", "delivery_status", "created_at"),
    )


class Inquiry(TimestampMixin, Base):
    __tablename__ = "inquiries"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    category: Mapped[str] = mapped_column(server_default="일반")
    title: Mapped[str]
    content: Mapped[str]
    status: Mapped[str] = mapped_column(server_default="답변대기")
    is_secret: Mapped[bool] = mapped_column(server_default=text("true"))
    answer: Mapped[str | None]
    answer_date: Mapped[datetime | None]
    answered_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), index=True
    )

    __table_args__ = (
        CheckConstraint(
            "category IN ('일반', '상품', '수선', '주문제작', '샘플제작')", name="category"
        ),
        CheckConstraint("status IN ('답변대기', '답변완료')", name="status"),
        CheckConstraint("char_length(title) BETWEEN 1 AND 200", name="title_length"),
        CheckConstraint("char_length(content) BETWEEN 1 AND 5000", name="content_length"),
        Index("ix_inquiries_admin_list", "status", "created_at", "id"),
        Index("ix_inquiries_public_list", "category", "created_at", "id"),
    )


class QuoteRequest(TimestampMixin, Base):
    __tablename__ = "quote_requests"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    quote_number: Mapped[str] = mapped_column(unique=True)  # QUO-YYYYMMDD-NNN — 채번은 api
    shipping_address_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("shipping_addresses.id", ondelete="SET NULL")
    )
    shipping_address_snapshot: Mapped[dict[str, Any] | None]
    options: Mapped[dict[str, Any]]
    quantity: Mapped[int]
    additional_notes: Mapped[str] = mapped_column(server_default="")
    contact_name: Mapped[str]
    business_name: Mapped[str] = mapped_column(server_default="")
    contact_method: Mapped[str]
    contact_value: Mapped[str]
    status: Mapped[str] = mapped_column(server_default="요청")
    quoted_amount: Mapped[int | None]
    quote_conditions: Mapped[str | None]
    admin_memo: Mapped[str | None]
    reference_images: Mapped[list[Any]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))

    __table_args__ = (
        CheckConstraint("quantity >= 100", name="quantity"),
        CheckConstraint("contact_method IN ('email', 'phone')", name="contact_method"),
        CheckConstraint("status IN ('요청', '견적발송', '협의중', '확정', '종료')", name="status"),
        CheckConstraint("quoted_amount IS NULL OR quoted_amount >= 0", name="quoted_amount"),
        Index("ix_quote_requests_admin_list", "status", "created_at", "id"),
    )


class QuoteRequestStatusLog(CreatedAtMixin, Base):
    __tablename__ = "quote_request_status_logs"

    id: Mapped[uuid.UUID] = uuid_pk()
    quote_request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("quote_requests.id", ondelete="CASCADE"), index=True
    )
    changed_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    previous_status: Mapped[str]
    new_status: Mapped[str]
    memo: Mapped[str | None]
    request_id: Mapped[str | None]


class RepairPickupRequest(CreatedAtMixin, Base):
    __tablename__ = "repair_pickup_requests"

    id: Mapped[uuid.UUID] = uuid_pk()
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"), unique=True)
    recipient_name: Mapped[str]
    recipient_phone: Mapped[str]
    postal_code: Mapped[str | None]
    address: Mapped[str]
    detail_address: Mapped[str | None]
    pickup_fee: Mapped[int]

    __table_args__ = (CheckConstraint("pickup_fee >= 0", name="pickup_fee"),)


class RepairShippingReceipt(CreatedAtMixin, Base):
    __tablename__ = "repair_shipping_receipts"

    id: Mapped[uuid.UUID] = uuid_pk()
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"), index=True)
    receipt_type: Mapped[str]
    reason: Mapped[str | None]
    memo: Mapped[str | None]
    photos: Mapped[list[Any]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))

    __table_args__ = (
        CheckConstraint("receipt_type IN ('tracking', 'no_tracking')", name="receipt_type"),
        CheckConstraint("reason IS NULL OR reason IN ('quick', 'overseas', 'lost')", name="reason"),
        CheckConstraint("memo IS NULL OR char_length(memo) <= 500", name="memo_length"),
    )


class AdminOperationLog(CreatedAtMixin, Base):
    """고위험 관리자 변경의 최소 append-only 감사 기록."""

    __tablename__ = "admin_operation_logs"

    id: Mapped[uuid.UUID] = uuid_pk()
    operation_id: Mapped[str] = mapped_column(unique=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    action: Mapped[str]
    target_type: Mapped[str]
    target_id: Mapped[str | None]
    target_count: Mapped[int | None]
    reason: Mapped[str]
    before_data: Mapped[dict[str, Any] | None] = mapped_column("before")
    after_data: Mapped[dict[str, Any] | None] = mapped_column("after")
    request_id: Mapped[str]

    __table_args__ = (
        CheckConstraint(
            "target_count IS NULL OR target_count >= 0",
            name="target_count",
        ),
        Index("ix_admin_operation_logs_created_at", "created_at", "id"),
    )


class PaymentIncident(TimestampMixin, Base):
    """외부 결제 결과가 불확실하거나 내부 상태와 어긋난 경우의 복구 queue."""

    __tablename__ = "payment_incidents"

    id: Mapped[uuid.UUID] = uuid_pk()
    operation_id: Mapped[str] = mapped_column(unique=True)
    incident_type: Mapped[str] = mapped_column("type")
    status: Mapped[str] = mapped_column(server_default="open")
    request_id: Mapped[str]
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    order_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"))
    claim_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("claims.id", ondelete="SET NULL"))
    expected_amount: Mapped[int]
    observed_amount: Mapped[int | None]
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    resolution_memo: Mapped[str | None]
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    resolved_at: Mapped[datetime | None]

    __table_args__ = (
        CheckConstraint(
            "type IN ('confirm', 'refund', 'partial_cancel', 'mixed_state', 'amount_mismatch')",
            name="type",
        ),
        CheckConstraint("status IN ('open', 'resolved')", name="status"),
        CheckConstraint("expected_amount >= 0", name="expected_amount"),
        CheckConstraint(
            "observed_amount IS NULL OR observed_amount >= 0",
            name="observed_amount",
        ),
        Index("ix_payment_incidents_queue", "status", "created_at", "id"),
        Index("ix_payment_incidents_order_id", "order_id"),
        Index("ix_payment_incidents_claim_id", "claim_id"),
    )


class AdminSetting(Base):
    __tablename__ = "admin_settings"

    key: Mapped[str] = mapped_column(primary_key=True)
    value: Mapped[str | None]
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )


class PricingConstant(Base):
    __tablename__ = "pricing_constants"

    key: Mapped[str] = mapped_column(primary_key=True)
    amount: Mapped[int]
    category: Mapped[str]
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    __table_args__ = (
        CheckConstraint("amount >= 0", name="amount"),
        CheckConstraint(
            "category IN ('custom_order', 'fabric', 'reform', 'token', 'sample_discount')",
            name="category",
        ),
    )


class NotificationPreferenceLog(CreatedAtMixin, Base):
    __tablename__ = "notification_preference_logs"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    previous_notification_consent: Mapped[bool]
    new_notification_consent: Mapped[bool]
    previous_notification_enabled: Mapped[bool]
    new_notification_enabled: Mapped[bool]


class ManualOrder(TimestampMixin, Base):
    """수기 주문 — 무통장·전화 접수 종이 작업지시서의 디지털 장부. 기존 주문 파이프라인과 무관."""

    __tablename__ = "manual_orders"

    id: Mapped[uuid.UUID] = uuid_pk()
    order_date: Mapped[date]
    customer_name: Mapped[str]
    phone: Mapped[str]
    address: Mapped[str | None]
    amount: Mapped[int]
    shipping_fee: Mapped[int] = mapped_column(server_default=text("0"))
    is_received: Mapped[bool] = mapped_column(server_default=text("false"))  # 접수
    is_paid: Mapped[bool] = mapped_column(server_default=text("false"))  # 결제
    is_confirmed: Mapped[bool] = mapped_column(server_default=text("false"))  # 확인
    items: Mapped[list[Any]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))

    __table_args__ = (
        CheckConstraint("amount >= 0", name="amount"),
        CheckConstraint("shipping_fee >= 0", name="shipping_fee"),
        Index("ix_manual_orders_admin_list", "order_date", "id"),
    )

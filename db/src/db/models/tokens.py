"""디자인 토큰 원장·구매 — 과금 로직(잔액 계산·차감·환불)은 api 소유."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from db.models.base import Base, CreatedAtMixin, TimestampMixin, uuid_pk


class DesignToken(CreatedAtMixin, Base):
    """토큰 원장 — 잔액 = 만료 필터 적용 후 amount 합 (기존 get_design_token_balance 의미)."""

    __tablename__ = "design_tokens"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    amount: Mapped[int]  # 지급 +, 차감 -
    type: Mapped[str]
    token_class: Mapped[str]
    request_type: Mapped[str | None]
    ai_model: Mapped[str | None]
    description: Mapped[str | None]
    work_id: Mapped[str | None]  # 생성 작업 단위 멱등 키
    source_order_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("orders.id"))
    expires_at: Mapped[datetime | None]

    __table_args__ = (
        CheckConstraint("amount <> 0", name="amount"),
        CheckConstraint("type IN ('grant', 'use', 'refund', 'admin', 'purchase')", name="type"),
        CheckConstraint("token_class IN ('paid', 'bonus', 'free')", name="token_class"),
        CheckConstraint(
            "request_type IS NULL OR request_type IN "
            "('analysis', 'prep', 'render_standard', 'render_high')",
            name="request_type",
        ),
        Index(
            "uq_design_tokens_work_id",
            "work_id",
            unique=True,
            postgresql_where=text("work_id IS NOT NULL"),
        ),
        Index(
            "ix_design_tokens_source_order_id",
            "source_order_id",
            postgresql_where=text("source_order_id IS NOT NULL"),
        ),
        Index(
            "ix_design_tokens_user_paid_expiry",
            "user_id",
            "expires_at",
            postgresql_where=text("token_class = 'paid' AND expires_at IS NOT NULL"),
        ),
        Index("ix_design_tokens_user_class", "user_id", "token_class"),
        Index("ix_design_tokens_user_created", "user_id", "created_at"),
    )


class TokenWork(CreatedAtMixin, Base):
    """미완료 차감 기록 — 모티프 생성·실사화가 끝났는지 대조하는 api 내부 작업 기록.

    worker 실행 큐도, 공개 완성본도 아니다. 차감 원장만으로는 외부 호출이 결과를 남겼는지
    판별할 수 없어서, 차감과 같은 트랜잭션에 pending을 남기고 종결에서 상태를 옮긴다.
    프로세스가 중간에 죽으면 기한이 지난 pending을 복구 배치가 정확히 한 번 환불한다
    (money.md §6). 생성 프롬프트·이미지·intent는 중복 저장하지 않는다.

    user_id는 CASCADE가 아니다 — 탈퇴가 미완료 과금 증거를 지우지 않는다(원장과 같은 규칙).
    """

    __tablename__ = "token_works"

    work_id: Mapped[str] = mapped_column(primary_key=True)  # 원장 멱등 키와 같은 값
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str]
    status: Mapped[str] = mapped_column(server_default="pending")
    started_at: Mapped[datetime]
    deadline_at: Mapped[datetime]  # 이 시각 이후의 pending만 복구 대상
    finished_at: Mapped[datetime | None]
    result_id: Mapped[str | None]  # motif_id 또는 generation_job id — 최소 결과 식별자

    __table_args__ = (
        CheckConstraint("kind IN ('motif_generate', 'design_finalize')", name="kind"),
        CheckConstraint("status IN ('pending', 'succeeded', 'refunded')", name="status"),
        CheckConstraint(
            "(status = 'pending') = (finished_at IS NULL)",
            name="finished_at_pair",
        ),
        # 복구 배치의 스캔 대상 — 기한 지난 pending만.
        Index(
            "ix_token_works_pending_deadline",
            "deadline_at",
            postgresql_where=text("status = 'pending'"),
        ),
    )


class TokenPurchase(TimestampMixin, Base):
    __tablename__ = "token_purchases"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    payment_group_id: Mapped[uuid.UUID]
    plan_key: Mapped[str]
    token_amount: Mapped[int]
    price: Mapped[int]
    status: Mapped[str] = mapped_column(server_default="대기중")
    payment_key: Mapped[str | None]

    __table_args__ = (
        UniqueConstraint("payment_group_id"),
        CheckConstraint("plan_key IN ('starter', 'popular', 'pro')", name="plan_key"),
        CheckConstraint("token_amount > 0", name="token_amount"),
        CheckConstraint("price > 0", name="price"),
        CheckConstraint("status IN ('대기중', '결제중', '완료', '실패')", name="status"),
    )

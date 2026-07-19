"""디자인 세션·잡 — LangGraph checkpoint 대체, api 소유 (ARCHITECTURE §2).

- 세션 상태(턴 이력·선택·게이트)는 api가 일반 테이블로 소유, 워커는 stateless.
- recraft 예산은 프로세스-로컬 카운터 대신 Postgres 공유 카운터(recraft_used)
  — 인스턴스 수와 무관하게 동작 (ARCHITECTURE §7).
- finalize 제한은 세션 카운터가 아니라 계정당 24시간 윈도우 쿼터 —
  generation_jobs 행을 직접 센다 (api/domains/design/quota.py).
- generation_jobs = finalize/export 비동기 잡(Cloud Tasks) 상태 폴링용.
"""

import uuid
from typing import Any

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Index, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from db.models.base import Base, CreatedAtMixin, TimestampMixin, uuid_pk

FINALIZE_DISPATCH_FAILED_MESSAGE = "finalize 작업 전달에 실패했습니다"
FINALIZE_STALE_MESSAGE = "finalize 작업 처리 시간이 초과되었습니다"
FINALIZE_CANCELED_MESSAGE = "사용자가 finalize 작업을 취소했습니다"
FINALIZE_TEMPORARY_FAILURE_CODE = "FINALIZE_TEMPORARY_FAILURE"
FINALIZE_TEMPORARY_FAILURE_MESSAGE = "finalize temporarily failed"
FINALIZE_TEMPORARY_FAILURE_MARKER = (
    f"{FINALIZE_TEMPORARY_FAILURE_CODE}: {FINALIZE_TEMPORARY_FAILURE_MESSAGE}"
)


class DesignSession(TimestampMixin, Base):
    __tablename__ = "design_sessions"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(server_default="active")
    seed: Mapped[int | None] = mapped_column(BigInteger)  # 재현 앵커
    colorway: Mapped[str | None]
    registry_version: Mapped[str | None]  # 커밋 시점 모티프 풀 핑거프린트
    current_intent: Mapped[dict[str, Any] | None]  # 마지막 커밋된 resolved intent
    recraft_used: Mapped[int] = mapped_column(server_default=text("0"))

    __table_args__ = (
        CheckConstraint("status IN ('active', 'finalized')", name="status"),
        CheckConstraint("recraft_used >= 0", name="recraft_used"),
    )


class DesignSessionTurn(CreatedAtMixin, Base):
    """턴 이력 최소 골격 — /design 신규 기획(5단계)에서 payload 스키마 구체화."""

    __tablename__ = "design_session_turns"

    id: Mapped[uuid.UUID] = uuid_pk()
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("design_sessions.id", ondelete="CASCADE")
    )
    seq: Mapped[int]
    role: Mapped[str]
    payload: Mapped[dict[str, Any]]

    __table_args__ = (UniqueConstraint("session_id", "seq"),)


class GenerationJob(TimestampMixin, Base):
    __tablename__ = "generation_jobs"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("design_sessions.id", ondelete="SET NULL")
    )
    kind: Mapped[str]
    status: Mapped[str] = mapped_column(server_default="queued")
    params: Mapped[dict[str, Any]]
    result: Mapped[dict[str, Any] | None]  # 산출물 object_key 등
    error_message: Mapped[str | None]
    request_id: Mapped[str | None]  # obs request_id — 전 구간 추적
    attempts: Mapped[int] = mapped_column(server_default=text("0"))

    __table_args__ = (
        CheckConstraint("kind IN ('finalize', 'export')", name="kind"),
        CheckConstraint(
            "status IN ('queued', 'processing', 'succeeded', 'failed', 'canceled')",
            name="status",
        ),
        Index("ix_generation_jobs_status_created", "status", "created_at"),
        # finalize 계정 쿼터의 24시간 윈도우 카운트용 — POST finalize·GET 세션마다 돈다
        Index("ix_generation_jobs_user_kind_created", "user_id", "kind", "status", "created_at"),
    )

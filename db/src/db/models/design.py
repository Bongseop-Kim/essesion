"""디자인 세션·잡 — LangGraph checkpoint 대체, api 소유 (ARCHITECTURE §1).

- 세션 상태(턴 이력·선택·게이트)는 api가 일반 테이블로 소유, 워커는 stateless.
- finalize는 동기 요청-응답 + 토큰 과금(design_finalize_cost) — generation_jobs는
  완성본 레코드(성공만 INSERT)로, 보관함·order-reference·삭제의 키다.
- current_intent/current_plan = 마지막 선택의 렌더/대화 정본.
- active_generation_id = 외부 호출 동안 세션당 생성 1개를 보장하는 짧은 lease.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Index, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from db.models.base import Base, CreatedAtMixin, TimestampMixin, uuid_pk


class DesignSession(TimestampMixin, Base):
    __tablename__ = "design_sessions"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(server_default="active")
    seed: Mapped[int | None] = mapped_column(BigInteger)  # 재현 앵커
    colorway: Mapped[str | None]
    registry_version: Mapped[str | None]  # 커밋 시점 모티프 풀 핑거프린트
    current_intent: Mapped[dict[str, Any] | None]  # 마지막 커밋된 resolved intent
    # 대화 의미 정본. motifs는 선택 시 concrete motif_id로 freeze되며 worker가
    # provider 전송 직전에 request-local alias로 치환한다.
    current_plan: Mapped[dict[str, Any] | None]
    context_version: Mapped[int] = mapped_column(BigInteger, server_default=text("0"))
    active_generation_id: Mapped[uuid.UUID | None]
    active_generation_started_at: Mapped[datetime | None]

    __table_args__ = (
        CheckConstraint("status IN ('active', 'finalized')", name="status"),
        CheckConstraint("context_version >= 0", name="context_version"),
        CheckConstraint(
            "(active_generation_id IS NULL) = (active_generation_started_at IS NULL)",
            name="active_generation_pair",
        ),
    )


class DesignSessionTurn(CreatedAtMixin, Base):
    """검증된 생성 요청·결과·선택·finalize 이벤트의 선형 턴 이력."""

    __tablename__ = "design_session_turns"

    id: Mapped[uuid.UUID] = uuid_pk()
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("design_sessions.id", ondelete="CASCADE")
    )
    seq: Mapped[int]
    role: Mapped[str]
    payload: Mapped[dict[str, Any]]

    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant')", name="role"),
        UniqueConstraint("session_id", "seq"),
    )


class UserMotif(CreatedAtMixin, Base):
    """사용자가 가져온 SVG 모티프의 계정별 라이브러리 관계.

    실제 정규화 symbol은 content-hash `motifs` 행에 보관한다. 이 관계를 삭제해도
    과거 세션 intent가 참조하는 불변 모티프는 유지된다.
    """

    __tablename__ = "user_motifs"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    motif_id: Mapped[str] = mapped_column(ForeignKey("motifs.id"))
    name: Mapped[str]

    __table_args__ = (UniqueConstraint("user_id", "motif_id"),)


class DesignTurnAttachment(CreatedAtMixin, Base):
    """생성 요청 턴에 사용한 정규화 모티프."""

    __tablename__ = "design_turn_attachments"

    id: Mapped[uuid.UUID] = uuid_pk()
    turn_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("design_session_turns.id", ondelete="CASCADE"), index=True
    )
    motif_id: Mapped[str] = mapped_column(ForeignKey("motifs.id"))
    filename: Mapped[str]
    ordinal: Mapped[int]

    __table_args__ = (UniqueConstraint("turn_id", "ordinal"),)


class DesignExample(TimestampMixin, Base):
    """첫 진입 갤러리에 노출하는 큐레이션 예시.

    상태는 전부 run(seamless_generation_logs)에서 파생되므로 예시는 run 포인터만
    들고 있으면 된다 — 고르면 토큰 과금 없이 새 세션의 시작점이 된다.
    """

    __tablename__ = "design_examples"

    id: Mapped[uuid.UUID] = uuid_pk()
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("seamless_generation_logs.id", ondelete="RESTRICT"), unique=True
    )
    name: Mapped[str]
    # 카드 라벨 둘째 줄 — 큐레이터가 쓰는 한 줄 설명. 없으면 제목만 그린다.
    caption: Mapped[str | None]
    ordinal: Mapped[int] = mapped_column(server_default=text("0"))
    published: Mapped[bool] = mapped_column(server_default=text("false"))

    __table_args__ = (Index("ix_design_examples_published_ordinal", "published", "ordinal"),)


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
    # 소요 시간 측정용 — 각 상태 전이가 직접 기록한다(updated_at 근사 대입 금지).
    # NULL = 아직 그 단계에 도달하지 않음. 재시도는 started_at을 현재 attempt로 덮어쓴다.
    started_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]

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

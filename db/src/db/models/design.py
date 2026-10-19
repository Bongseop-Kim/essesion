"""디자인 세션 — 템플릿에서 시작해 로고를 바꾸는 편집 상태, api 소유 (ARCHITECTURE §1).

- 세션 상태(턴 이력·포인터)는 api가 일반 테이블로 소유, 워커는 stateless.
- current_intent/current_plan = 마지막 선택의 렌더 정본.
- active_generation_id = 로고 교체 재렌더 동안 세션당 1개를 보장하는 짧은 lease.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
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
    # 템플릿 플랜(DesignPlan v3) — 템플릿 시작·로고 교체가 갱신한다.
    current_plan: Mapped[dict[str, Any] | None]
    context_version: Mapped[int] = mapped_column(BigInteger, server_default=text("0"))
    active_generation_id: Mapped[uuid.UUID | None]
    active_generation_started_at: Mapped[datetime | None]
    # 어느 템플릿(예시)에서 시작했는지 — store가 포인트 위치·로고 슬롯을 템플릿에서 읽는다.
    # use_alter: 세션→예시→run→세션 FK 순환을 메타데이터 정렬에서 끊는다(DDL은 ALTER로 뒤에 붙음).
    example_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("design_examples.id", ondelete="SET NULL", use_alter=True)
    )

    __table_args__ = (
        CheckConstraint("status IN ('active')", name="status"),
        CheckConstraint("context_version >= 0", name="context_version"),
        CheckConstraint(
            "(active_generation_id IS NULL) = (active_generation_started_at IS NULL)",
            name="active_generation_pair",
        ),
    )


class DesignSessionTurn(CreatedAtMixin, Base):
    """템플릿 시작·로고 교체 결과의 선형 턴 이력."""

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
    # 템플릿 데이터 — 정본은 시드 코드(apps/worker/scripts/seed_design_examples.py), 여기는 전달용.
    category: Mapped[str | None]  # 목록 필터 칩 라벨 그대로
    point: Mapped[str] = mapped_column(server_default="none")  # 포인트 로고 자리: none|top|bottom
    # 로고를 받을 자리 [{slot: 1|2|"logo", label}] — 순서대로 업로드 칸. 없으면 서버 규칙 한 자리.
    logo_slots: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    photo_full_url: Mapped[str | None]  # 사용자가 준비할 실사 사진(전체 샷), 없으면 결정론 샷
    photo_detail_url: Mapped[str | None]  # 실사 사진(무늬 확대)

    __table_args__ = (
        Index("ix_design_examples_published_ordinal", "published", "ordinal"),
        CheckConstraint("point IN ('none', 'top', 'bottom')", name="point"),
    )

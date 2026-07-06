"""사용자·인증 — auth.users + profiles 병합 재설계 (MAPPING.md §1)."""

import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Index, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from db.models.base import Base, CreatedAtMixin, TimestampMixin, uuid_pk

# 유일한 PG enum — 값 추가는 수동 ALTER TYPE 리비전 필요 (db/README.md 규칙)
user_role = Enum("customer", "admin", "manager", name="user_role")


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str | None]  # 소셜(카카오) 이메일 미동의 가능 — 부분 unique
    password_hash: Mapped[str | None]  # argon2id — id/pw 테스트 로그인 전용, 공개 가입 없음
    name: Mapped[str]
    phone: Mapped[str | None]
    role: Mapped[str] = mapped_column(user_role, server_default="customer")
    is_active: Mapped[bool] = mapped_column(server_default=text("true"))
    birth: Mapped[date | None]
    phone_verified: Mapped[bool] = mapped_column(server_default=text("false"))
    notification_consent: Mapped[bool] = mapped_column(server_default=text("false"))
    notification_enabled: Mapped[bool] = mapped_column(server_default=text("true"))
    marketing_kakao_sms_consent: Mapped[bool] = mapped_column(server_default=text("false"))

    __table_args__ = (
        Index("uq_users_email", "email", unique=True, postgresql_where=text("email IS NOT NULL")),
    )


class UserIdentity(CreatedAtMixin, Base):
    __tablename__ = "user_identities"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[str]
    provider_user_id: Mapped[str]

    __table_args__ = (
        CheckConstraint("provider IN ('google', 'kakao', 'apple', 'naver')", name="provider"),
        UniqueConstraint("provider", "provider_user_id"),
    )


class RefreshToken(CreatedAtMixin, Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(unique=True)
    expires_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None]


class PhoneVerification(CreatedAtMixin, Base):
    __tablename__ = "phone_verifications"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    phone: Mapped[str]
    code: Mapped[str]
    expires_at: Mapped[datetime]  # 발급 시 api가 now+5분 설정 (재전송 60초/일 5회 제한도 api)
    verified: Mapped[bool] = mapped_column(server_default=text("false"))

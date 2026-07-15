"""휴대폰 인증 — docs/api-spec/domains.md §1 (재전송 60초 / 일 5회 / 만료 5분)."""

import hashlib
import hmac
import re
import secrets
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from db.models.auth import PhoneVerification, User
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import USER_LOCK, advisory_xact_lock
from api.errors import DomainError, RateLimitedError, UnauthorizedError, UpstreamError
from api.integrations.solapi import SolapiClient

PHONE_PATTERN = re.compile(r"^01[0-9]{8,9}$")
KST = ZoneInfo("Asia/Seoul")
RESEND_INTERVAL_SECONDS = 60
DAILY_LIMIT = 5
CODE_TTL = timedelta(minutes=5)
MAX_VERIFY_ATTEMPTS = 5


def normalize_phone(phone: str) -> str:
    normalized = phone.replace("-", "")
    if not PHONE_PATTERN.fullmatch(normalized):
        raise DomainError("유효하지 않은 휴대폰 번호입니다", code="invalid_phone")
    return normalized


def _code_digest(secret: str, user_id, phone: str, code: str) -> str:  # noqa: ANN001 — UUID
    payload = f"phone-verification:{user_id}:{phone}:{code}".encode()
    return hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()


async def _lock_active_user(session: AsyncSession, user: User) -> None:
    await advisory_xact_lock(session, USER_LOCK.format(user_id=user.id))
    current = await session.scalar(
        select(User).where(User.id == user.id).execution_options(populate_existing=True)
    )
    if current is None or not current.is_active:
        raise UnauthorizedError()


async def send_verification(
    session: AsyncSession,
    user: User,
    phone: str,
    solapi: SolapiClient,
    *,
    secret: str,
) -> None:
    normalized = normalize_phone(phone)
    await _lock_active_user(session, user)

    last_created = await session.scalar(
        select(func.max(PhoneVerification.created_at)).where(PhoneVerification.user_id == user.id)
    )
    now = datetime.now(UTC)
    if last_created is not None and (now - last_created).total_seconds() < RESEND_INTERVAL_SECONDS:
        raise RateLimitedError("1분 후 재전송 가능합니다")

    today_start = datetime.now(KST).replace(hour=0, minute=0, second=0, microsecond=0)
    today_count = await session.scalar(
        select(func.count())
        .select_from(PhoneVerification)
        .where(PhoneVerification.user_id == user.id, PhoneVerification.created_at >= today_start)
    )
    if today_count is not None and today_count >= DAILY_LIMIT:
        raise RateLimitedError("오늘 인증 시도 횟수를 초과했습니다")

    code = f"{secrets.randbelow(1_000_000):06d}"
    verification = PhoneVerification(
        user_id=user.id,
        phone=normalized,
        code=_code_digest(secret, user.id, normalized, code),
        expires_at=now + CODE_TTL,
    )
    session.add(verification)
    await session.commit()

    sent = await solapi.send_sms(
        normalized, f"[ESSE SION] 인증번호는 [{code}]입니다. 5분 내에 입력해주세요."
    )
    if not sent:
        # 발송 실패 — 방금 레코드 삭제(일일 카운트·재전송 대기 미소모)
        await session.execute(
            delete(PhoneVerification).where(PhoneVerification.id == verification.id)
        )
        await session.commit()
        raise UpstreamError("문자 발송에 실패했습니다. 다시 시도해주세요.")


async def verify_code(
    session: AsyncSession,
    user: User,
    phone: str,
    code: str,
    *,
    secret: str,
) -> None:
    normalized = normalize_phone(phone)
    await _lock_active_user(session, user)
    record = await session.scalar(
        select(PhoneVerification)
        .where(
            PhoneVerification.user_id == user.id,
            PhoneVerification.phone == normalized,
            PhoneVerification.verified.is_(False),
        )
        .order_by(PhoneVerification.created_at.desc())
        .limit(1)
        .with_for_update()
    )
    if record is None:
        raise DomainError("인증번호를 다시 요청해주세요", code="verification_not_found")
    now = datetime.now(UTC)
    if record.expires_at < now:
        raise DomainError("인증번호가 만료되었습니다", code="verification_expired")
    if record.locked_at is not None or record.failed_attempts >= MAX_VERIFY_ATTEMPTS:
        raise RateLimitedError("인증번호 시도 횟수를 초과했습니다. 새 인증번호를 요청해주세요.")
    expected = _code_digest(secret, user.id, normalized, code)
    # 배포 직전 발급된 5분 수명의 legacy 평문 코드만 짧게 호환한다.
    legacy_matches = (
        len(record.code) == 6 and record.code.isdigit() and hmac.compare_digest(record.code, code)
    )
    if not hmac.compare_digest(record.code, expected) and not legacy_matches:
        record.failed_attempts += 1
        locked = record.failed_attempts >= MAX_VERIFY_ATTEMPTS
        if locked:
            record.locked_at = now
        await session.commit()
        if locked:
            raise RateLimitedError("인증번호 시도 횟수를 초과했습니다. 새 인증번호를 요청해주세요.")
        raise DomainError("인증번호가 일치하지 않습니다", code="verification_mismatch")

    record.verified = True
    user.phone = normalized
    user.phone_verified = True
    await session.commit()

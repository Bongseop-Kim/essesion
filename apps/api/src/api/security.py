"""JWT(access) + 불투명 refresh 토큰 + argon2id.

- access: PyJWT HS256, 15분, 클레임 {sub, role, iat, exp}.
- refresh: secrets.token_urlsafe(32) 원문은 클라이언트(httpOnly 쿠키)에만,
  DB(refresh_tokens.token_hash)에는 sha256 hex만 저장.
- argon2 verify/hash는 CPU 바운드 — 호출부에서 run_in_threadpool로 감쌀 것.
"""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash

from api.config import Settings
from api.errors import UnauthorizedError

ALGORITHM = "HS256"

password_hasher = PasswordHash.recommended()  # argon2id


def create_access_token(user_id: uuid.UUID, role: str, settings: Settings) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": str(user_id),
            "role": role,
            "iat": now,
            "exp": now + timedelta(minutes=settings.access_ttl_minutes),
        },
        settings.jwt_secret,
        algorithm=ALGORITHM,
    )


def decode_access_token(token: str, settings: Settings) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    except jwt.PyJWTError as exc:
        raise UnauthorizedError() from exc


def new_refresh_token() -> tuple[str, str]:
    """(클라이언트에 줄 원문, DB에 저장할 sha256 hex)."""
    raw = secrets.token_urlsafe(32)
    return raw, hash_refresh_token(raw)


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()

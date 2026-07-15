"""일회성 운영 관리자 bootstrap·복구 CLI.

비밀번호를 shell history에 남기지 않도록 모든 자격 증명은 환경 변수로 받는다.

  export BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
  uv run python apps/api/scripts/bootstrap_admin.py create
  uv run python apps/api/scripts/bootstrap_admin.py reset-password
  uv run python apps/api/scripts/bootstrap_admin.py revoke-sessions
"""

import argparse
import asyncio
import os

from api.config import get_settings
from api.db import build_engine
from api.domains.auth.admin_ops import (
    create_initial_admin,
    reset_admin_password,
    revoke_admin_sessions,
)
from api.errors import DomainError
from sqlalchemy.ext.asyncio import async_sessionmaker


def _required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"{name} 환경 변수가 필요합니다")
    return value


async def _run(command: str) -> str:
    email = _required_env("BOOTSTRAP_ADMIN_EMAIL")
    password = (
        _required_env("BOOTSTRAP_ADMIN_PASSWORD") if command in ("create", "reset-password") else ""
    )
    settings = get_settings()
    engine = build_engine(settings)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with maker() as session:
            if command == "create":
                user = await create_initial_admin(
                    session,
                    email=email,
                    password=password,
                    name=os.environ.get("BOOTSTRAP_ADMIN_NAME", "관리자"),
                )
                return f"관리자 bootstrap 완료: {user.email}"
            if command == "reset-password":
                user = await reset_admin_password(
                    session,
                    email=email,
                    password=password,
                )
                return f"관리자 비밀번호 재설정 및 admin session 폐기 완료: {user.email}"
            user = await revoke_admin_sessions(session, email=email)
            return f"admin session 폐기 완료: {user.email}"
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("create", "reset-password", "revoke-sessions"))
    args = parser.parse_args()
    try:
        print(asyncio.run(_run(args.command)))
    except DomainError as exc:
        raise SystemExit(exc.detail) from exc


if __name__ == "__main__":
    main()

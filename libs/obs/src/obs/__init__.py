"""관측 골격 (ARCHITECTURE §2): JSON 구조화 로깅(Cloud Logging 자동 파싱) +
request_id 전파(api→worker 추적) + Sentry(DSN 있을 때만)."""

import json
import logging
import os
import sys
import uuid
from contextvars import ContextVar
from datetime import UTC, datetime

request_id_var: ContextVar[str] = ContextVar("request_id", default="")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, object] = {
            # Cloud Logging이 인식하는 필드명 (severity/message/time)
            "severity": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
            "time": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
        }
        if rid := request_id_var.get():
            entry["request_id"] = rid
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False)


def init_observability(service: str) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
    if dsn := os.environ.get("SENTRY_DSN"):
        import sentry_sdk

        sentry_sdk.init(dsn=dsn, environment=os.environ.get("ENV", "local"))
    logging.getLogger(service).info("observability initialized")


class RequestIdMiddleware:
    """순수 ASGI 미들웨어: X-Request-ID 수신 시 승계(워커가 api 발급 ID를 이어받음),
    없으면 발급. 응답 헤더로 반환하고 로그 컨텍스트에 주입."""

    def __init__(self, app):  # noqa: ANN001 — ASGI app
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        rid = headers.get(b"x-request-id", b"").decode() or uuid.uuid4().hex
        token = request_id_var.set(rid)

        async def send_with_rid(message):
            if message["type"] == "http.response.start":
                message.setdefault("headers", []).append((b"x-request-id", rid.encode()))
            await send(message)

        try:
            await self.app(scope, receive, send_with_rid)
        finally:
            request_id_var.reset(token)

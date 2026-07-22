"""관측 골격 (ARCHITECTURE §2): JSON 구조화 로깅(Cloud Logging 자동 파싱) +
request_id 전파(api→worker 추적) + Sentry(DSN 있을 때만)."""

import json
import logging
import os
import re
import sys
import uuid
from contextvars import ContextVar
from datetime import UTC, datetime

request_id_var: ContextVar[str] = ContextVar("request_id", default="")

_STRUCTURED_LOG_FIELDS = (
    "event",
    "stage",
    "provider",
    "operation",
    "reason_code",
    "status_code",
    "duration_ms",
    "attempt",
)

# request_id는 워커에서 GCS object key(previews/{rid}/...)에 들어간다 — 인바운드
# X-Request-ID를 무정제로 에코하면 `/`·`..` 경로 주입이 가능하므로 정제한다.
_REQUEST_ID_RE = re.compile(r"[^A-Za-z0-9_-]+")
_MAX_REQUEST_ID_LEN = 128


def sanitize_request_id(raw: str) -> str:
    """허용 문자(영숫자·`-`·`_`) 외는 `-`로 치환, 길이 상한, 빈 결과면 새 uuid 발급."""
    clean = _REQUEST_ID_RE.sub("-", raw)[:_MAX_REQUEST_ID_LEN].strip("-_")
    return clean or uuid.uuid4().hex


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
        for key in _STRUCTURED_LOG_FIELDS:
            if (value := getattr(record, key, None)) is not None:
                entry[key] = value
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
        rid = sanitize_request_id(headers.get(b"x-request-id", b"").decode("latin-1"))
        # Starlette의 최외곽 500 handler는 사용자 middleware가 unwind된 뒤 실행된다.
        # 그 경로에서도 같은 ID를 회수할 수 있도록 request scope에 보존한다.
        scope["request_id"] = rid
        token = request_id_var.set(rid)

        async def send_with_rid(message):
            if message["type"] == "http.response.start":
                headers = [
                    (key, value)
                    for key, value in message.get("headers", [])
                    if key.lower() != b"x-request-id"
                ]
                headers.append((b"x-request-id", rid.encode()))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_rid)
        finally:
            request_id_var.reset(token)

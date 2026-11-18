"""메일 발송 (iCloud+ 커스텀 도메인 SMTP — docs/api-spec/domains.md §7).

표준 라이브러리 smtplib만 쓴다. 구조는 solapi.py와 같다: 설정이 차면 Real, local/test는
DryRun(보낸 메시지를 sent 리스트에 쌓는다), 그 밖의 환경에서 설정이 비면 Unavailable.
"""

import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage
from typing import Protocol

from api.config import Settings
from api.errors import ServiceUnavailableError, UpstreamError

logger = logging.getLogger(__name__)

XLSX_MIME = ("application", "vnd.openxmlformats-officedocument.spreadsheetml.sheet")
SMTP_TIMEOUT_SECONDS = 10  # 요청이 메일 서버에 오래 붙잡히지 않게
SEND_FAILED = "견적서 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요."


class Mailer(Protocol):
    capability_mode: str

    async def send(
        self, *, to: str, subject: str, text: str, attachment: tuple[str, bytes] | None = None
    ) -> None: ...


def _message(
    sender: str, to: str, subject: str, text: str, attachment: tuple[str, bytes] | None
) -> EmailMessage:
    message = EmailMessage()
    message["From"] = f"ESSE SION <{sender}>"
    message["To"] = to
    message["Reply-To"] = sender
    message["Subject"] = subject
    message.set_content(text)
    if attachment is not None:
        filename, data = attachment
        maintype, subtype = XLSX_MIME
        message.add_attachment(data, maintype=maintype, subtype=subtype, filename=filename)
    return message


class RealMailer:
    capability_mode = "real"

    def __init__(self, settings: Settings):
        self._host = settings.smtp_host
        self._port = settings.smtp_port
        self._username = settings.smtp_username
        self._password = settings.smtp_password
        self._sender = settings.mail_from

    def _send_sync(self, message: EmailMessage) -> None:
        with smtplib.SMTP(self._host, self._port, timeout=SMTP_TIMEOUT_SECONDS) as smtp:
            # context를 주지 않으면 smtplib은 인증서·호스트명을 검증하지 않는다.
            # 앱 암호를 보내기 전에 서버가 진짜인지 확인한다.
            smtp.starttls(context=ssl.create_default_context())
            smtp.login(self._username, self._password)
            smtp.send_message(message)

    async def send(
        self, *, to: str, subject: str, text: str, attachment: tuple[str, bytes] | None = None
    ) -> None:
        message = _message(self._sender, to, subject, text, attachment)
        try:
            await asyncio.to_thread(self._send_sync, message)
        except (smtplib.SMTPException, OSError) as exc:
            # 받는 주소는 PII라 남기지 않는다.
            logger.error("메일 발송 실패: %s", type(exc).__name__)
            raise UpstreamError(SEND_FAILED) from exc


class DryRunMailer:
    capability_mode = "dry_run"

    def __init__(self, settings: Settings):
        self._sender = settings.mail_from
        self.sent: list[EmailMessage] = []

    async def send(
        self, *, to: str, subject: str, text: str, attachment: tuple[str, bytes] | None = None
    ) -> None:
        logger.info("DRYRUN mail: %s", subject)
        self.sent.append(_message(self._sender, to, subject, text, attachment))


class UnavailableMailer:
    """운영에서 설정이 비면 보낸 척하지 않고 실패로 응답한다."""

    capability_mode = "unavailable"

    async def send(
        self, *, to: str, subject: str, text: str, attachment: tuple[str, bytes] | None = None
    ) -> None:
        logger.error("Mailer capability unavailable")
        raise ServiceUnavailableError("메일 발송을 지금 사용할 수 없습니다.")


def build_mailer(settings: Settings) -> Mailer:
    if settings.smtp_username and settings.smtp_password:
        return RealMailer(settings)
    if settings.env in ("local", "test"):
        logger.warning("SMTP 설정 없음 — local/test DryRun 메일 클라이언트로 동작")
        return DryRunMailer(settings)
    logger.error("SMTP 설정 없음 — Mailer capability unavailable")
    return UnavailableMailer()

"""단일 인스턴스 in-memory rate limit과 trusted-edge client IP 해석.

Cloudflare rate limit이 최종 외곽 방어선이며, 이 구현은 로컬과 Cloud Run 단일
인스턴스에서 비정상 반복을 빠르게 차단하는 보조선이다. 키 수를 제한해 메모리가
요청자 수에 비례해 무한히 늘지 않게 한다.
"""

import hashlib
import hmac
import ipaddress
from collections import OrderedDict, deque
from time import monotonic

from starlette.requests import Request

from api.errors import RateLimitedError


class AuthRateLimiter:
    def __init__(
        self,
        *,
        attempts: int,
        window_seconds: int,
        max_keys: int,
        detail: str = "관리자 인증 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
    ):
        if attempts < 1 or window_seconds < 1 or max_keys < 1:
            raise ValueError("rate limit settings must be positive")
        self.attempts = attempts
        self.window_seconds = window_seconds
        self.max_keys = max_keys
        self.detail = detail
        self._requests: OrderedDict[str, deque[float]] = OrderedDict()

    def check(self, key: str, *, now: float | None = None) -> None:
        current = monotonic() if now is None else now
        cutoff = current - self.window_seconds
        requests = self._requests.get(key)
        if requests is None:
            if len(self._requests) >= self.max_keys:
                self._requests.popitem(last=False)
            requests = deque()
            self._requests[key] = requests
        else:
            self._requests.move_to_end(key)

        while requests and requests[0] <= cutoff:
            requests.popleft()
        if len(requests) >= self.attempts:
            raise RateLimitedError(self.detail)
        requests.append(current)


class RecentKeyCache:
    """민감한 원문 대신 digest만 보관하는 bounded TTL cache."""

    def __init__(self, *, ttl_seconds: int, max_keys: int):
        if ttl_seconds < 1 or max_keys < 1:
            raise ValueError("cache settings must be positive")
        self.ttl_seconds = ttl_seconds
        self.max_keys = max_keys
        self._expires: OrderedDict[str, float] = OrderedDict()

    def contains(self, key: str, *, now: float | None = None) -> bool:
        current = monotonic() if now is None else now
        self._purge(current)
        expires_at = self._expires.get(self._digest(key))
        if expires_at is None:
            return False
        return expires_at > current

    def add(self, key: str, *, now: float | None = None) -> None:
        current = monotonic() if now is None else now
        self._purge(current)
        digest = self._digest(key)
        self._expires[digest] = current + self.ttl_seconds
        self._expires.move_to_end(digest)
        while len(self._expires) > self.max_keys:
            self._expires.popitem(last=False)

    def _purge(self, current: float) -> None:
        while self._expires:
            key, expires_at = next(iter(self._expires.items()))
            if expires_at > current:
                return
            self._expires.pop(key)

    @staticmethod
    def _digest(key: str) -> str:
        return hashlib.sha256(key.encode()).hexdigest()


def request_client_ip(request: Request) -> str | None:
    """공유 secret으로 인증된 Cloudflare 요청에서만 원본 IP를 신뢰한다."""
    connected_host = request.client.host if request.client is not None else None
    settings = request.app.state.settings
    if settings.env in ("local", "test") or not settings.edge_proxy_secret:
        return connected_host

    edge_secrets = request.headers.getlist("x-essesion-edge-secret")
    forwarded_ips = request.headers.getlist("cf-connecting-ip")
    if len(edge_secrets) != 1 or len(forwarded_ips) != 1:
        return connected_host
    if not hmac.compare_digest(edge_secrets[0], settings.edge_proxy_secret):
        return connected_host
    try:
        return str(ipaddress.ip_address(forwarded_ips[0]))
    except ValueError:
        return connected_host


def client_rate_limit_key(path: str, client_host: str | None) -> str:
    return f"{path}:{client_host or 'unknown'}"

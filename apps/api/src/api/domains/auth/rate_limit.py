"""관리자 인증용 단일 인스턴스 in-memory rate limit.

Cloudflare rate limit이 최종 외곽 방어선이며, 이 구현은 로컬과 Cloud Run 단일
인스턴스에서 비정상 반복을 빠르게 차단하는 보조선이다. 키 수를 제한해 메모리가
요청자 수에 비례해 무한히 늘지 않게 한다.
"""

from collections import OrderedDict, deque
from time import monotonic

from api.errors import RateLimitedError


class AuthRateLimiter:
    def __init__(self, *, attempts: int, window_seconds: int, max_keys: int):
        if attempts < 1 or window_seconds < 1 or max_keys < 1:
            raise ValueError("rate limit settings must be positive")
        self.attempts = attempts
        self.window_seconds = window_seconds
        self.max_keys = max_keys
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
            raise RateLimitedError("관리자 인증 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.")
        requests.append(current)


def admin_auth_rate_limit_key(path: str, client_host: str | None) -> str:
    return f"{path}:{client_host or 'unknown'}"

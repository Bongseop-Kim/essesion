"""디자인 문장 안의 모티프 요청을 좁게 감지한다.

요청을 처리하지 못했다는 증거(patch의 `out_of_scope`, 모티프 없이 끝난 첫 저작)가 있을 때만
원문 어휘를 읽어 피커 안내 sidecar 하나를 만든다 — 별도 모델 호출은 없다.
"""

from __future__ import annotations

import re

# 줄무늬는 지원하는 구성 축이라 "줄무늬"의 무늬는 집지 않는다.
_MOTIF_WORDS = re.compile(
    r"(?:모티프|(?<!줄)무늬|도형|형태|로고|아이콘|꽃)|\b(?:motif|shape|logo|icon)\b",
    re.IGNORECASE,
)
# subject는 검색창에 그대로 들어간다 — 수식어를 집으면 0건 검색이라 명사 조각만 뽑는다.
_REPLACEMENT_SUBJECT = re.compile(
    r"(?P<subject>[가-힣A-Za-z0-9_-]{1,40})(?:으)?로\s*"
    r"(?:바꿔|바꾸|변경|교체|replace|change)",
    re.IGNORECASE,
)
_KOREAN_FLOWER_SUBJECT = re.compile(
    r"(?P<subject>[가-힣A-Za-z0-9_-]{1,40}꽃)(?:은|는|이|가|을|를|로|으로)?"
)


def _subject(prompt: str) -> str | None:
    for pattern in (_REPLACEMENT_SUBJECT, _KOREAN_FLOWER_SUBJECT):
        match = pattern.search(prompt)
        if match is None:
            continue
        subject = match.group("subject").strip(" _-")
        # 어휘 자체("무늬"·"logo")는 검색어가 아니다.
        if subject and not _MOTIF_WORDS.fullmatch(subject):
            return subject
    return None


def detect_motif_intent(
    prompt: str,
    *,
    llm_out_of_scope: bool = False,
    motif_missing: bool = False,
) -> dict[str, object] | None:
    """Return a picker hint only when the request demonstrably went unhandled."""

    if llm_out_of_scope:
        reason = "motif_change"
    # 첫 저작이 모티프 레이어 없이 끝났는데 문장은 모티프를 말했다 — 카탈로그 miss다.
    elif motif_missing and _MOTIF_WORDS.search(prompt):
        reason = "motif_mention"
    else:
        return None
    return {"detected": True, "subject": _subject(prompt), "reason": reason}

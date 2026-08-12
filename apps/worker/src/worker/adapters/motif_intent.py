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
# 텍스타일 단골 소재 — 위 어휘와 달리 단어 자체가 검색어라서 _subject가 그대로 돌려준다.
# 구성 축과 겹치는 말(줄무늬·체크 같은 배치·분할 표현)은 넣지 않는다: 처리한 요청에
# 피커를 띄우게 된다.
_MATERIAL_WORDS_PATTERN = (
    r"페이즐리|다마스크|아가일|헤링본|\b(?:paisley|damask|argyle|herringbone)\b"
)
_MATERIAL_WORDS = re.compile(rf"(?P<subject>{_MATERIAL_WORDS_PATTERN})", re.IGNORECASE)
# subject는 검색창에 그대로 들어간다 — 수식어를 집으면 0건 검색이라 명사 조각만 뽑는다.
_REPLACEMENT_SUBJECT = re.compile(
    r"(?P<subject>[가-힣A-Za-z0-9_-]{1,40})(?:으)?로\s*"
    r"(?:바꿔|바꾸|변경|교체|replace|change)",
    re.IGNORECASE,
)
_KOREAN_FLOWER_SUBJECT = re.compile(
    r"(?P<subject>[가-힣A-Za-z0-9_-]{1,40}꽃)(?:은|는|이|가|을|를|로|으로)?"
)
_COLOR_WORDS = (
    r"네이비|남색|navy|버건디|burgundy|아이보리|ivory|금색|골드|gold|빨강|빨간|red|"
    r"파랑|파란|하늘|blue|초록|녹색|green|노랑|노란|yellow|검정|검은|black|흰|하양|white|"
    r"회색|gray|grey|분홍|핑크|pink|보라|purple|주황|오렌지|orange|갈색|브라운|brown|"
    r"베이지|beige|은색|실버|silver"
)
# 모티프 색은 정책상 고정이다 — 색만 바꾸라는 요청은 피커에 안내할 게 없으니 거절 알림으로 끝낸다.
# ponytail: 어휘~색 사이 6자 창으로 좁게 본다. "모티프 대신 배경을 네이비로"처럼 사이에 다른
# 대상이 끼면 오탐할 수 있고, 그때는 창을 좁히기보다 대상 어휘 파싱이 필요하다.
_MOTIF_COLOR_CHANGE = re.compile(
    rf"(?:{_MOTIF_WORDS.pattern}|{_MATERIAL_WORDS_PATTERN})"
    rf"[^.!?\n]{{0,6}}?(?:{_COLOR_WORDS})(?:색|상)?\s*(?:으)?로",
    re.IGNORECASE,
)


def _subject(prompt: str) -> str | None:
    # 소재 이름은 마지막에 본다 — "페이즐리를 나비로 바꿔"는 교체 대상(나비)이 검색어다.
    for pattern in (_REPLACEMENT_SUBJECT, _KOREAN_FLOWER_SUBJECT, _MATERIAL_WORDS):
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

    if _MOTIF_COLOR_CHANGE.search(prompt):
        return None
    if llm_out_of_scope:
        reason = "motif_change"
    # 첫 저작이 모티프 레이어 없이 끝났는데 문장은 모티프를 말했다 — 카탈로그 miss다.
    elif motif_missing and (_MOTIF_WORDS.search(prompt) or _MATERIAL_WORDS.search(prompt)):
        reason = "motif_mention"
    else:
        return None
    return {"detected": True, "subject": _subject(prompt), "reason": reason}

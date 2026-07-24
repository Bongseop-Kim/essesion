"""자유텍스트 facet 유입 게이트 — 임베딩·프롬프트로 들어가기 전 살균.

recraft 모티프 facet(subject/description/style/view/expression/tags)은 관리자 게이트
없이 cross-user 카탈로그가 되고, 다른 사용자의 Gemini 프롬프트에 주입된다. 유일한 자동
방어선이므로 저장·임베딩 전에 이 함수를 통과시킨다.

- ``sanitize_facet_text``: 제어(Cc)·서식(Cf, 제로폭·BOM·양방향 포함)·서로게이트(Cs) 문자
  제거 후 NFC 정규화. 이 문자들은 facet 텍스트에 정당한 용도가 없고 임베딩/검색을 오염
  시키거나 비가시 문자로 숨은 지시를 밀반입한다. 길이 상한은 요청 스키마가 강제한다 —
  임의의 다국어 모티프 텍스트에 양성 문자 화이트리스트는 오탐 밭이라 두지 않는다.
- ``is_suspicious_facet_text``: 명령형 프롬프트 인젝션 휴리스틱. 거부하지 않고 True만
  반환한다 — Motif는 사용자 콘텐츠라 오탐이 정상 모티프를 막고, Gallery는 사람이 최종
  승인한다. 호출자가 로그/관리자 플래그로 처리한다.
"""

import re
import unicodedata

# 명령형 인젝션 휴리스틱 (영/한). 정상 모티프 설명을 막지 않도록 좁게 유지 — 플래그 전용.
_INJECTION = re.compile(
    r"ignore\s+(?:all\s+|the\s+)?(?:previous|above|prior|earlier)|"
    r"disregard\s+(?:all\s+|the\s+)?(?:previous|above|prior|earlier)|"
    r"system\s+prompt|"
    r"you\s+are\s+now\b|"
    r"as\s+an?\s+ai\b|"
    r"###\s*(?:instruction|system)|"
    r"<\|[^|]*\|>|"  # chat-template 센티넬
    r"(?:이전|위|앞)[^\n]{0,6}(?:지시|명령|프롬프트|내용)[^\n]{0,6}무시",
    re.IGNORECASE,
)


def sanitize_facet_text(value: str) -> str:
    """제어·서식·서로게이트 문자 제거 후 NFC. 탭/개행/CR은 공백으로 접어 단어 경계 보존."""
    out = [
        " " if ch in "\t\n\r" else ch
        for ch in value
        if ch in "\t\n\r" or unicodedata.category(ch) not in ("Cc", "Cf", "Cs")
    ]
    return unicodedata.normalize("NFC", "".join(out))


def is_suspicious_facet_text(value: str) -> bool:
    """명령형 인젝션 패턴이 보이면 True (거부가 아니라 플래그용)."""
    return bool(_INJECTION.search(value))

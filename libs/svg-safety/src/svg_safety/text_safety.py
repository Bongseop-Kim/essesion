"""자유텍스트 facet 유입 게이트 — 임베딩·프롬프트로 들어가기 전 살균.

recraft 모티프 facet(subject/description/style/view/expression/tags)은 관리자 게이트
없이 cross-user 카탈로그가 되고, 다른 사용자의 LLM 프롬프트에 주입된다. 저장·임베딩
전 살균과 호환 문자 정규화 기반 사전검사를 거치고, 모델 호출자는 별도의 데이터 경계와
상위 수준 지시로 facet을 명령이 아닌 비신뢰 데이터로 취급해야 한다.

- ``sanitize_facet_text``: 제어(Cc)·서식(Cf, 제로폭·BOM·양방향 포함)·서로게이트(Cs) 문자
  제거, 모든 Unicode 공백의 ASCII 공백 치환 후 NFC 정규화. 이 문자들은 facet 텍스트에
  정당한 용도가 없고 임베딩/검색을 오염시키거나 비가시 문자로 숨은 지시를 밀반입한다.
  길이 상한은 요청 스키마가 강제한다 — 임의의 다국어 모티프 텍스트에 양성 문자
  화이트리스트는 오탐 밭이라 두지 않는다.
- ``is_suspicious_facet_text``: NFKC·casefold 사전 정규화 뒤 적용하는 다국어 명령형
  프롬프트 인젝션 휴리스틱. 거부하지 않고 True만 반환하며, 데이터 경계의 보조 방어선이다.
  호출자가 유입 거부·필드 제외·관리자 플래그 중 문맥에 맞는 조치를 한다.
"""

import re
import unicodedata

# 명령형 인젝션 휴리스틱. 정상 모티프 설명을 막지 않도록 좁게 유지 — 플래그 전용.
_INJECTION = re.compile(
    r"ignore\s+(?:all\s+|the\s+)?(?:previous|above|prior|earlier)|"
    r"disregard\s+(?:all\s+|the\s+)?(?:previous|above|prior|earlier)|"
    r"system\s+prompt|"
    r"you\s+are\s+now\b|"
    r"as\s+an?\s+ai\b|"
    r"###\s*(?:instruction|system)|"
    r"<\|[^|]*\|>|"  # chat-template 센티넬
    r"(?:이전|위|앞)[^\n]{0,6}(?:지시|명령|프롬프트|내용)[^\n]{0,6}무시|"
    r"(?:忽略|无视|無視)[^\n]{0,8}(?:之前|以前|先前|上述|上面)"
    r"[^\n]{0,8}(?:指令|指示|提示词|提示|内容)|"
    r"(?:以前|上記|これまで)[^\n]{0,8}(?:指示|命令|プロンプト|内容)"
    r"[^\n]{0,8}(?:無視|むし)|"
    r"(?:ignora|ignore|ignorar)\s+(?:todas?\s+)?(?:las?\s+)?"
    r"(?:instrucciones|indicaciones)\s+(?:anteriores|previas)|"
    r"(?:시스템\s*프롬프트|系统\s*(?:提示词|提示)|システム\s*プロンプト)",
    re.IGNORECASE,
)


def sanitize_facet_text(value: str) -> str:
    """제어·서식·서로게이트 문자 제거 후 NFC. Unicode 공백은 ASCII 공백으로 접는다."""
    out: list[str] = []
    for ch in value:
        if ch.isspace():
            out.append(" ")
        elif unicodedata.category(ch) not in ("Cc", "Cf", "Cs"):
            out.append(ch)
    return unicodedata.normalize("NFC", "".join(out))


def _normalize_for_injection_check(value: str) -> str:
    """호환 문자·대소문자·Unicode 공백 변형을 명령형 검사 전에 정규화한다."""
    normalized = unicodedata.normalize("NFKC", sanitize_facet_text(value)).casefold()
    return " ".join(normalized.split())


def is_suspicious_facet_text(value: str) -> bool:
    """정규화한 텍스트에 명령형 인젝션 패턴이 보이면 True (플래그용)."""
    return bool(_INJECTION.search(_normalize_for_injection_check(value)))

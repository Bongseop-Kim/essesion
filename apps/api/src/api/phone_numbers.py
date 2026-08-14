import re

PHONE_PATTERN = re.compile(r"^01[0-9]{8,9}$")
PHONE_INPUT_PATTERN = re.compile(r"^[0-9\s()-]+$")


def normalize_mobile_phone(value: str) -> str:
    """국내 휴대폰 번호를 DB 저장용 숫자 문자열로 정규화한다."""
    trimmed = value.strip()
    if not PHONE_INPUT_PATTERN.fullmatch(trimmed):
        raise ValueError("유효하지 않은 휴대폰 번호입니다")
    normalized = re.sub(r"[^0-9]", "", trimmed)
    if not PHONE_PATTERN.fullmatch(normalized):
        raise ValueError("유효하지 않은 휴대폰 번호입니다")
    return normalized

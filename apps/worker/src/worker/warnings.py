"""엔진 경고 → 고객 문구.

엔진·리졸버·렌더는 진단용 영문 문자열을 남긴다(로그·admin의 정본). 응답에는 코드와 한글
한 줄만 함께 내려, 프론트가 그대로 노출할 수 있게 한다. 매핑에 없는 코드는 내려보내지
않는다 — 고객이 읽을 문구가 없는 경고는 로그에만 남는다.
"""

from __future__ import annotations

# ponytail: 경계에서 문자열을 분류한다. 엔진이 (코드, 상세)를 직접 내도록 바꾸는 편이
# 정공법이지만 validate·constraints·resolver·render 전부를 건드려야 한다 — 경고 종류가
# 늘어 이 표가 흔들리면 그때 옮긴다.
_CODES: tuple[tuple[str, str], ...] = (
    # "(lattice cell" — dpi 클램프 경고까지 삼키지 않게 격자 클램프만 집는다.
    ("(lattice cell", "motif_size_clamped"),
    ("snapped to", "spacing_snapped"),
    ("widths reduced to keep the background visible", "stripe_coverage_reduced"),
    ("outside CMYK gamut", "color_out_of_gamut"),
    ("preview upload skipped", "preview_unavailable"),
    (" dropped", "motif_dropped"),
    ("has no visible slot", "named_color_unplaced"),
    ("grounded only approximately", "motif_approximate_match"),
)

WARNING_MESSAGES: dict[str, str] = {
    "motif_size_clamped": "무늬가 겹치지 않게 크기를 조금 줄였어요.",
    "spacing_snapped": "무늬가 이어지도록 간격을 살짝 맞췄어요.",
    "stripe_coverage_reduced": "바탕이 보이도록 줄 너비를 조금 줄였어요.",
    "color_out_of_gamut": "이 색은 실제 인쇄에서 조금 다르게 보일 수 있어요.",
    "preview_unavailable": "미리보기 이미지는 저장하지 못했어요. 디자인은 그대로예요.",
    "motif_dropped": "쓸 수 없는 무늬가 있어 그 부분은 빼고 만들었어요.",
    "named_color_unplaced": "요청한 색 중 일부는 넣을 자리가 없어 빼고 만들었어요.",
    "motif_approximate_match": (
        "요청하신 그림과 꼭 맞는 무늬가 없어 비슷한 그림으로 만들었어요. "
        "왼쪽 모티프에서 바꿀 수 있어요."
    ),
}


def customer_warnings(texts: list[str]) -> list[dict[str, str]]:
    """응답용 `[{code, message}]` — 코드별 1건, 진단 순서 유지."""

    seen: dict[str, str] = {}
    for text in texts:
        code = next((code for needle, code in _CODES if needle in text), None)
        if code is not None and code not in seen and code in WARNING_MESSAGES:
            seen[code] = WARNING_MESSAGES[code]
    return [{"code": code, "message": message} for code, message in seen.items()]

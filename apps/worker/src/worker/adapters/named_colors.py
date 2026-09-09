"""최초 저작의 지명색 접지 — "네이비 바탕", "골드 줄무늬"를 실제 플랜 슬롯에 반영한다.

저작 모델은 좁은 지명색 어휘를 자주 무시하거나 근처 색으로 바꿔 놓는다. 프롬프트로는
위반율이 떨어지지 않아 여기서 결정론적으로 정규화한다. 문장 안에서 색이 어떤 역할
(바탕·줄무늬)에 붙었는지만 읽고, 그 역할이 쓰는 슬롯의 hex를 요청 색으로 맞춘다.
모티프 artwork와 색은 이 단계에서 바꾸지 않는다.

구성 수정(patch) 경로는 이 모듈을 쓰지 않는다 — 거기서는 색이 patch 필드로 직접 들어온다.
"""

from __future__ import annotations

import re

from worker.authoring.schema import DesignPlanV3
from worker.engine.constraints import normalize_hex
from worker.engine.palette import hex_to_rgb

_GROUND_MODIFIER_WORDS = r"짙은|진한|밝은|연한|어두운|옅은|deep|dark|light|pale|rich|soft"
_DIRECT_ROLE_CONNECTOR = re.compile(
    r"\s*(?:(?:색(?:상)?|컬러|colou?red?|in|of|for|"
    rf"은|는|이|가|을|를|만|의|로|으로|인|-|{_GROUND_MODIFIER_WORDS})\s*)*",
    re.IGNORECASE,
)
# 영어는 관사·전치사·강도 수식어만 빼고 본다 — "the background"는 색 표현이 아니다.
_GROUND_ADJACENT_STOP_WORDS = (
    rf"the|an?|for|in|of|on|with|and|to|as|its|my|our|your|this|that|same|whole|entire|"
    rf"plain|solid|only|{_GROUND_MODIFIER_WORDS}"
)
_GROUND_ADJACENT_BEFORE = re.compile(
    rf"(?:{_GROUND_MODIFIER_WORDS})?\s*"
    rf"([가-힣]{{1,6}}|\b(?!(?:{_GROUND_ADJACENT_STOP_WORDS})\s*$)[A-Za-z]{{2,12}})\s*$",
    re.IGNORECASE,
)
_GROUND_ADJACENT_AFTER = re.compile(
    rf"\s*(?:{_GROUND_MODIFIER_WORDS})?\s*(?:은|는)?\s*([가-힣]{{1,6}})(?:으로|로)",
    re.IGNORECASE,
)
_STRIPE_WORDS = re.compile(
    r"(스트라이프(?:\s*구조)?|줄무늬(?:\s*구조)?|stripe(?:\s+structure)?|\bband\b)",
    re.IGNORECASE,
)
_MOTIF_WORDS = re.compile(r"(모티프|무늬|도형|형태|주제|subject|motif|shape|icon)", re.IGNORECASE)
_GROUND_WORDS = re.compile(r"(바탕|배경(?:색)?|background|ground)", re.IGNORECASE)
_NAMED_COLOR_TARGETS = (
    (re.compile(r"(네이비|남색|navy)", re.IGNORECASE), "navy", "#000080"),
    (re.compile(r"(버건디|burgundy)", re.IGNORECASE), "burgundy", "#800020"),
    (re.compile(r"(아이보리|ivory)", re.IGNORECASE), "ivory", "#FFFFF0"),
    (re.compile(r"(금색|골드|gold)", re.IGNORECASE), "gold", "#D4AF37"),
    # 표에 없는 색은 접지되지 않아 모델 재량이다 — "흰 바탕"이 10회 중 1회 다른 색으로 나왔다
    # (2026-09-09 실측). 넥타이에서 가장 흔한 바탕색이라 표에 넣는다.
    (re.compile(r"(흰색|흰|하양|화이트|white)", re.IGNORECASE), "white", "#FFFFFF"),
)


def _color_distance(color: str, target: str) -> int:
    return sum(
        (value - expected) ** 2
        for value, expected in zip(hex_to_rgb(color), hex_to_rgb(target), strict=True)
    )


_NAMED_COLOR_ALTERNATION = "|".join(
    f"(?:{pattern.pattern})" for pattern, _name, _hex in _NAMED_COLOR_TARGETS
)
_NAMED_COLOR_ROLE = r"(?:색(?:상)?|계열|바탕|배경(?:색)?|colou?r|background|ground)"
_NAMED_COLOR_PARTICLE = r"(?:은|는|이|가|을|를|만)?"
_NAMED_COLOR_NEGATIVE = r"(?:없이|빼|제외|사용하지|쓰지|아니라|대신|without|remove|exclude)"
_NAMED_COLOR_JOINER = r"(?:와|과|및|또는|,|/|and|or)"
_NAMED_COLOR_EXCLUDED_BEFORE = re.compile(
    # \b: "merino"·"kimono"처럼 no로 끝나는 단어가 배제어로 오인되지 않게 한다.
    rf"\b(?:without|remove|exclude|no|instead\s+of|rather\s+than)\s+"
    rf"(?:the\s+)?(?:(?:{_NAMED_COLOR_ALTERNATION})(?:\s*{_NAMED_COLOR_ROLE})?\s*"
    rf"{_NAMED_COLOR_JOINER}\s*)*$",
    re.IGNORECASE,
)
_NAMED_COLOR_EXCLUDED_AFTER = re.compile(
    rf"\s*(?:{_NAMED_COLOR_ROLE})?\s*{_NAMED_COLOR_PARTICLE}\s*{_NAMED_COLOR_NEGATIVE}",
    re.IGNORECASE,
)
_NAMED_COLOR_EXCLUDED_AFTER_LIST = re.compile(
    rf"\s*(?:{_NAMED_COLOR_JOINER}\s*(?:{_NAMED_COLOR_ALTERNATION})"
    rf"(?:\s*{_NAMED_COLOR_ROLE})?\s*)+{_NAMED_COLOR_PARTICLE}\s*{_NAMED_COLOR_NEGATIVE}",
    re.IGNORECASE,
)
_NAMED_COLOR_EXCLUDED_INSTEAD = re.compile(r"\s*(?:대신|가\s+아니라)")


# 이름 옆에 hex를 직접 적었으면 그 hex가 이긴다 — "금색 #FFD700"은 표의 금색이 아니라 그 값이다.
# \b는 못 쓴다 — "#ffd700으로"의 한글은 단어 문자라 경계가 생기지 않는다.
_ADJACENT_HEX = r"#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])"
_EXPLICIT_HEX_AFTER = re.compile(rf"^[\s\-은는이가의로]*(?:색상?|컬러)?[\s\-]*({_ADJACENT_HEX})")
_EXPLICIT_HEX_BEFORE = re.compile(rf"({_ADJACENT_HEX})[\s\-]*$")


def _explicit_hex(prompt: str, match: re.Match[str]) -> str | None:
    """색 이름에 바로 붙은 명시 hex — 없으면 None."""
    after = _EXPLICIT_HEX_AFTER.match(prompt[match.end() : match.end() + 16])
    if after:
        return normalize_hex(after.group(1))
    before = _EXPLICIT_HEX_BEFORE.search(prompt[max(0, match.start() - 12) : match.start()])
    return normalize_hex(before.group(1)) if before else None


def _named_color_is_excluded(prompt: str, match: re.Match[str]) -> bool:
    before = prompt[max(0, match.start() - 64) : match.start()]
    after = prompt[match.end() : match.end() + 64]
    return bool(
        _NAMED_COLOR_EXCLUDED_BEFORE.search(before)
        or _NAMED_COLOR_EXCLUDED_AFTER.match(after)
        or _NAMED_COLOR_EXCLUDED_AFTER_LIST.match(after)
        or _NAMED_COLOR_EXCLUDED_INSTEAD.match(after)
    )


def requested_named_colors(prompt: str) -> list[tuple[str, str, list[re.Match[str]]]]:
    requested = []
    for pattern, name, target_hex in _NAMED_COLOR_TARGETS:
        matches = [
            match
            for match in pattern.finditer(prompt)
            if not _named_color_is_excluded(prompt, match)
        ]
        explicit = next(
            (found for match in matches if (found := _explicit_hex(prompt, match))), None
        )
        requested.append((name, explicit or target_hex, matches))
    return sorted(
        (item for item in requested if item[2]),
        key=lambda item: item[2][0].start(),
    )


def normalize_requested_named_colors(
    prompt: str,
    plan: DesignPlanV3,
    *,
    unassigned: list[str] | None = None,
) -> DesignPlanV3:
    """Apply the small supported named-color vocabulary to existing PlanV3 slots.

    ``unassigned``가 주어지면 자리 없는 색을 거기에 적고 나머지만 반영한다(기본은 raise).
    """

    requested = requested_named_colors(prompt)
    if not requested:
        return plan

    stripe_roles = list(_STRIPE_WORDS.finditer(prompt))
    motif_roles = [
        motif
        for motif in _MOTIF_WORDS.finditer(prompt)
        if not any(
            stripe.start() <= motif.start() and motif.end() <= stripe.end()
            for stripe in stripe_roles
        )
    ]

    def nearby_targets(roles: list[re.Match[str]], *, direct_role: bool = False) -> set[str]:
        targets: set[str] = set()
        for role in roles:
            candidates = [
                (
                    min(abs(color.end() - role.start()), abs(role.end() - color.start())),
                    color.start(),
                    name,
                )
                for name, _target_hex, matches in requested
                for color in matches
                if not direct_role
                or _DIRECT_ROLE_CONNECTOR.fullmatch(
                    prompt[color.end() : role.start()]
                    if color.end() <= role.start()
                    else prompt[role.end() : color.start()]
                )
            ]
            distance, _position, name = min(candidates, default=(17, 0, ""))
            if distance <= 16:
                targets.add(name)
        return targets

    def ground_has_unrecognized_adjacent_word(role: re.Match[str]) -> bool:
        # 바탕/배경 바로 옆에 붙은 말이 등록된 지명색이 아니면(예: "짙은 초록 바탕"의 "초록")
        # 그 슬롯은 이미 그 말이 차지한 것 — 멀리 있는 다른 지명색을 끌어와 덮지 않는다.
        before = prompt[max(0, role.start() - 24) : role.start()]
        after = prompt[role.end() : role.end() + 24]
        before_match = _GROUND_ADJACENT_BEFORE.search(before)
        after_match = _GROUND_ADJACENT_AFTER.match(after)
        candidates = [m.group(1) for m in (before_match, after_match) if m]
        return any(
            not any(pattern.fullmatch(word) for pattern, _name, _hex in _NAMED_COLOR_TARGETS)
            for word in candidates
        )

    ground_roles = list(_GROUND_WORDS.finditer(prompt))
    ground_targets = nearby_targets(ground_roles, direct_role=True)
    if not ground_targets and not any(
        ground_has_unrecognized_adjacent_word(role) for role in ground_roles
    ):
        # 직접 수식 관계로 못 찾았고, 바탕 바로 옆에 미등록 색 표현도 없으면 기존처럼
        # 근접(<=16자) 추정으로 넘어간다 — 예: "use navy only for the background".
        ground_targets = nearby_targets(ground_roles)
    if len(ground_targets) > 1:
        # 바탕 슬롯은 하나 — 프롬프트에서 먼저 나온 지명색만 바탕에 배정하고,
        # 나머지는 스트라이프/모티프/단일 역할 처리로 넘긴다.
        first_ground = next(name for name, _hex, _m in requested if name in ground_targets)
        ground_targets = {first_ground}
    stripe_targets = nearby_targets(stripe_roles, direct_role=True) - ground_targets
    immutable_motif_targets = (
        nearby_targets(motif_roles, direct_role=True) - ground_targets - stripe_targets
    )
    for name, _target, matches in requested:
        if name in ground_targets or name in stripe_targets or name in immutable_motif_targets:
            continue
        if any(
            (
                subject := re.search(
                    r"([가-힣A-Za-z0-9_-]{1,20})(?:은|는|을|를)\s*$",
                    prompt[max(0, match.start() - 24) : match.start()],
                )
            )
            and subject.group(1).casefold()
            not in {"색", "색상", "컬러", "팔레트", "color", "palette"}
            for match in matches
        ):
            immutable_motif_targets.add(name)

    # An explicit motif-color request cannot be represented by DesignPlanV3 anymore. Leave the
    # fixed artwork untouched instead of redirecting that color to an unrelated palette role.
    requested = [item for item in requested if item[0] not in immutable_motif_targets]
    if not requested:
        return plan

    raw_plan = plan.model_dump(mode="json")
    colors = list(plan.colors)
    ground_color_index = plan.ground_color_index
    layers = raw_plan["layers"]

    def redirect_stripe_color(source: int, target: int) -> bool:
        changed = False
        for layer in layers:
            if layer["type"] == "stripe":
                for band in layer["bands"]:
                    if band["color_index"] == source:
                        band["color_index"] = target
                        changed = True
        return changed

    stripe_slots: set[int] = set()
    for layer in plan.layers:
        if layer.type == "stripe":
            stripe_slots.update(band.color_index for band in layer.bands)
    used: set[int] = set()
    ordered = sorted(requested, key=lambda item: item[0] not in ground_targets)
    for name, target, _matches in ordered:
        existing = next((index for index, color in enumerate(colors) if color == target), None)
        if name in ground_targets:
            if existing is not None:
                ground_color_index = existing
            else:
                colors[ground_color_index] = target
            used.add(ground_color_index)
            continue
        # 남은 가시 역할은 stripe뿐 — stripe를 직접 지목하지 않았고 stripe 슬롯도 없을
        # 때만 바탕으로 넘긴다.
        role_is_ground = name not in stripe_targets and not stripe_slots
        if existing is not None:
            if existing in stripe_slots:
                used.add(existing)
                continue
            available = [index for index in stripe_slots if index not in used]
            if not available and not stripe_slots and ground_color_index not in used:
                available = [ground_color_index]
            if not available:
                if unassigned is not None:
                    unassigned.append(name)
                    continue
                raise ValueError(f"named color {name} is not referenced by a visible layer")
            closest = min(available, key=lambda index: _color_distance(colors[index], target))
            if role_is_ground:
                ground_color_index = existing
            else:
                if not redirect_stripe_color(closest, existing):
                    raise ValueError(f"named color {name} cannot be assigned to its visible role")
                stripe_slots = (stripe_slots - {closest}) | {existing}
            used.add(existing)
            continue
        available = [index for index in stripe_slots if index not in used]
        if not available and not stripe_slots and ground_color_index not in used:
            available = [ground_color_index]
        if not available:
            # 저작 루프는 이 문장을 피드백으로 받아 재저작한다 — 마지막 시도만 관용한다.
            if unassigned is not None:
                unassigned.append(name)
                continue
            raise ValueError(f"plan has no visible slot available for named color {name}")
        closest = min(available, key=lambda index: _color_distance(colors[index], target))
        colors[closest] = target
        used.add(closest)

    return DesignPlanV3.model_validate(
        {
            **raw_plan,
            "colors": colors,
            "ground_color_index": ground_color_index,
            "layers": layers,
        }
    )

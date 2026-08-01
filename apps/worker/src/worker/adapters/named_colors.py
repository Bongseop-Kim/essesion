"""최초 저작의 지명색 접지 — "네이비 바탕", "골드 모티프"를 실제 플랜 슬롯에 반영한다.

저작 모델은 좁은 지명색 어휘를 자주 무시하거나 근처 색으로 바꿔 놓는다. 프롬프트로는
위반율이 떨어지지 않아 여기서 결정론적으로 정규화한다. 문장 안에서 색이 어떤 역할
(바탕·줄무늬·모티프)에 붙었는지만 읽고, 그 역할이 쓰는 슬롯의 hex를 요청 색으로 맞춘다.

구성 수정(patch) 경로는 이 모듈을 쓰지 않는다 — 거기서는 색이 patch 필드로 직접 들어온다.
"""

from __future__ import annotations

import re

from worker.authoring.schema import DesignPlanV3
from worker.engine.palette import hex_to_rgb

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
    requested = [
        (
            name,
            target_hex,
            [
                match
                for match in pattern.finditer(prompt)
                if not _named_color_is_excluded(prompt, match)
            ],
        )
        for pattern, name, target_hex in _NAMED_COLOR_TARGETS
    ]
    return sorted(
        (item for item in requested if item[2]),
        key=lambda item: item[2][0].start(),
    )


def _plan_motif_slot_counts(
    plan: DesignPlanV3,
    exact_motif_metadata: list[dict[str, object]] | None,
    catalog_candidates: list[dict[str, object]] | None,
) -> list[int]:
    """motif_index별 paint slot 수. 메타데이터가 없으면 1로 간주한다."""

    by_ref = {
        str(candidate.get("catalog_ref")): candidate for candidate in catalog_candidates or []
    }
    counts: list[int] = []
    for source in plan.motifs:
        record: dict[str, object] | None = None
        if source.source == "catalog":
            record = by_ref.get(source.catalog_ref)
        elif source.source == "input" and exact_motif_metadata is not None:
            if 1 <= source.input_index <= len(exact_motif_metadata):
                record = exact_motif_metadata[source.input_index - 1]
        slot_count = record.get("slot_count") if record is not None else None
        counts.append(
            slot_count
            if isinstance(slot_count, int) and not isinstance(slot_count, bool) and slot_count > 0
            else 1
        )
    return counts


def normalize_requested_named_colors(
    prompt: str,
    plan: DesignPlanV3,
    *,
    exact_motif_metadata: list[dict[str, object]] | None = None,
    catalog_candidates: list[dict[str, object]] | None = None,
) -> DesignPlanV3:
    """Apply the small supported named-color vocabulary to existing PlanV3 slots."""

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
                or re.fullmatch(
                    r"\s*(?:(?:색(?:상)?|컬러|colou?red?|in|of|for|"
                    r"은|는|이|가|을|를|의|로|으로|인|-)\s*)*",
                    (
                        prompt[color.end() : role.start()]
                        if color.end() <= role.start()
                        else prompt[role.end() : color.start()]
                    ),
                    re.IGNORECASE,
                )
            ]
            distance, _position, name = min(candidates, default=(17, 0, ""))
            if distance <= 16:
                targets.add(name)
        return targets

    ground_targets = nearby_targets(list(_GROUND_WORDS.finditer(prompt)))
    if len(ground_targets) > 1:
        # 바탕 슬롯은 하나 — 프롬프트에서 먼저 나온 지명색만 바탕에 배정하고,
        # 나머지는 스트라이프/모티프/단일 역할 처리로 넘긴다.
        first_ground = next(name for name, _hex, _m in requested if name in ground_targets)
        ground_targets = {first_ground}
    stripe_targets = nearby_targets(stripe_roles, direct_role=True) - ground_targets
    motif_targets = nearby_targets(motif_roles, direct_role=True) - ground_targets - stripe_targets
    for name, _target, matches in requested:
        if name in ground_targets or name in stripe_targets or name in motif_targets:
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
            motif_targets.add(name)

    raw_plan = plan.model_dump(mode="json")
    colors = list(plan.colors)
    ground_color_index = plan.ground_color_index
    layers = raw_plan["layers"]

    def redirect_role_color(role: str, source: int, target: int) -> bool:
        changed = False
        for layer in layers:
            if role == "stripe" and layer["type"] == "stripe":
                for band in layer["bands"]:
                    if band["color_index"] == source:
                        band["color_index"] = target
                        changed = True
            elif role == "motif" and layer["type"] == "motif":
                indices = layer.get("color_indices")
                if indices is not None and source in indices:
                    layer["color_indices"] = [
                        target if index == source else index for index in indices
                    ]
                    changed = True
        return changed

    stripe_slots: set[int] = set()
    motif_slots: set[int] = set()
    # color_indices를 생략한 모티프 레이어는 컴파일러가 첫 비-바탕 슬롯을 색으로 고르지만
    # 원본색 유지 모티프는 그 팔레트 값을 쓰지 않는다. 그 슬롯에 지명색을 쓸 때는
    # 매핑도 함께 명시화해 조용한 무시 대신 바인딩 단계 검증을 받게 한다.
    # 멀티슬롯 모티프는 같은 인덱스를 slot_count만큼 반복해 길이 계약을 지킨다.
    slot_counts = _plan_motif_slot_counts(plan, exact_motif_metadata, catalog_candidates)
    implicit_slot_layers: dict[int, list[tuple[int, int]]] = {}
    for position, layer in enumerate(plan.layers):
        if layer.type == "stripe":
            stripe_slots.update(band.color_index for band in layer.bands)
        elif layer.color_indices is not None:
            motif_slots.update(layer.color_indices)
        else:
            guessed = next(
                (index for index in range(len(colors)) if index != plan.ground_color_index),
                plan.ground_color_index,
            )
            motif_slots.add(guessed)
            implicit_slot_layers.setdefault(guessed, []).append(
                (position, slot_counts[layer.motif_index])
            )
    layer_slots = stripe_slots | motif_slots
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
        if name in stripe_targets:
            role = "stripe"
            role_slots = stripe_slots
            target_slots = stripe_slots - motif_slots
        elif name in motif_targets:
            role = "motif"
            role_slots = motif_slots
            target_slots = motif_slots - stripe_slots
        elif stripe_slots and motif_slots:
            if existing is not None and existing in layer_slots:
                used.add(existing)
                continue
            raise ValueError(f"named color {name} has no unambiguous visible role")
        else:
            role = "stripe" if stripe_slots else "motif" if motif_slots else "ground"
            role_slots = layer_slots
            target_slots = layer_slots
        if existing is not None:
            if existing in target_slots:
                used.add(existing)
                continue
            available = [index for index in target_slots if index not in used]
            if not available:
                available = [index for index in role_slots if index not in used]
            if (
                not available
                and not target_slots
                and not layer_slots
                and ground_color_index not in used
            ):
                available = [ground_color_index]
            if not available:
                raise ValueError(f"named color {name} is not referenced by a visible layer")
            closest = min(available, key=lambda index: _color_distance(colors[index], target))
            if role == "ground":
                ground_color_index = existing
            elif not redirect_role_color(role, closest, existing):
                raise ValueError(f"named color {name} cannot be assigned to its visible role")
            if role == "stripe":
                stripe_slots = (stripe_slots - {closest}) | {existing}
            elif role == "motif":
                motif_slots = (motif_slots - {closest}) | {existing}
            layer_slots = stripe_slots | motif_slots
            used.add(existing)
            continue
        available = [index for index in target_slots if index not in used]
        if (
            not available
            and not target_slots
            and not layer_slots
            and ground_color_index not in used
        ):
            available = [ground_color_index]
        if not available:
            raise ValueError(f"plan has no visible slot available for named color {name}")
        closest = min(available, key=lambda index: _color_distance(colors[index], target))
        colors[closest] = target
        for position, slot_count in implicit_slot_layers.pop(closest, []):
            layers[position]["color_indices"] = [closest] * slot_count
        used.add(closest)

    return DesignPlanV3.model_validate(
        {
            **raw_plan,
            "colors": colors,
            "ground_color_index": ground_color_index,
            "layers": layers,
        }
    )

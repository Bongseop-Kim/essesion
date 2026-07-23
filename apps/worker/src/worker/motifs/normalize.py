"""authored/Recraft SVG → 모티프 인테이크 계약 정규화 (worker-motifs.md §1·§2).

파이프라인: allowlist 파싱·검증 → 프레임 검증 → tight bbox 프레이밍 → (선택) 색 양자화
→ slotify → `<g>` 래핑 + content-hash id → (선택) render gate.

정규화된 모티프는 항상 bbox `(-0.5,-0.5,0.5,0.5)`, anchor `(0,0)`. content-hash는
slotify **후**의 geometry에서 뽑으므로 같은 도형은 colorway 무관 같은 id(upsert 멱등의 근거).
"""

from __future__ import annotations

import hashlib
import html
import re
import xml.etree.ElementTree as ET
from collections.abc import Iterator
from dataclasses import dataclass
from typing import cast

import svg_safety as sanitize

from worker.engine.palette import hex_to_rgb, is_hex_color
from worker.engine.units import fmt
from worker.motifs.registry import MotifDef, slot_render_symbols

BBox = tuple[float, float, float, float]
Anchor = tuple[float, float]

_UNIT_BBOX: BBox = (-0.5, -0.5, 0.5, 0.5)
_ORIGIN: Anchor = (0.0, 0.0)

# render gate: 고정 mm/DPI 타일 + 10% 투명 마진 — 렌더 크기가 결정론적이고, 단위 박스를
# 꽉 채운 모티프가 오탐되지 않는다(선언 bbox를 넘치는 geometry만 테두리에 닿아 seam 유발).
_GATE_RENDER_MM = 10.0
_GATE_RENDER_DPI = 300
_GATE_MARGIN_FRAC = 0.1

MAX_MOTIF_SVG_BYTES = 2_000_000
MAX_MOTIF_NODES = 2_048
MAX_MOTIF_DEPTH = 64
MAX_MOTIF_PATHS = 1_024
MAX_MOTIF_PATH_COMMANDS = 50_000
MAX_MOTIF_GEOMETRY_TOKENS = 200_000
_PATH_COMMAND = re.compile(r"[MmLlHhVvCcSsQqTtAaZz]")
_NUMBER_TOKEN = re.compile(r"[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")

# defs 밖에서 실제로 그려지는 요소.
_RENDERABLE = frozenset({"path", "polygon", "polyline", "rect", "circle", "ellipse", "line", "use"})


@dataclass(frozen=True)
class NormalizedMotif:
    """MotifDef 호환 필드(compose가 소비) — facet 메타는 store가 별도로 받는다."""

    id: str
    symbol: str
    bbox_mm: BBox = _UNIT_BBOX
    anchor: Anchor = _ORIGIN
    color_slots: tuple[str, ...] = ("s0",)
    # Standalone, importable document showing the exact geometry that produced this identity.
    # It uses deterministic concrete preview colors because internal s0/s1 slot tokens are not
    # valid CSS paints. Re-normalizing this document must recover the same id and symbol.
    preview_svg: str = ""


def _tag(el: ET.Element) -> str:
    return el.tag.rsplit("}", 1)[-1].lower() if isinstance(el.tag, str) else ""


def _validate_frame(root: ET.Element) -> None:
    """작성자 좌표 프레임(viewBox 또는 치수)의 온전성만 검증 — 0/음수 extent 거부."""
    vb = root.get("viewBox")
    if vb:
        nums = [float(p) for p in vb.replace(",", " ").split()]
        if len(nums) != 4:
            raise ValueError(f"motif SVG has a malformed viewBox: {vb!r}")
        if nums[2] <= 0 or nums[3] <= 0:
            raise ValueError(f"motif SVG viewBox must have positive width/height: {vb!r}")
        return
    w = float(root.get("width", "0") or 0)
    h = float(root.get("height", "0") or 0)
    if w <= 0 or h <= 0:
        raise ValueError("motif SVG needs a viewBox or positive width/height")


def _has_drawable(elements: list[ET.Element]) -> bool:
    for el in elements:
        tag = _tag(el)
        if tag == "defs":
            continue
        if tag in _RENDERABLE:
            return True
        if _has_drawable(list(el)):
            return True
    return False


def _validate_intake_complexity(root: ET.Element) -> None:
    """Bound attacker-controlled trees before geometry traversal or render checks."""

    nodes = paths = path_commands = geometry_tokens = 0
    stack = [(root, 1)]
    while stack:
        element, depth = stack.pop()
        if depth > MAX_MOTIF_DEPTH:
            raise ValueError(f"motif SVG is nested too deeply (max depth {MAX_MOTIF_DEPTH})")
        nodes += 1
        if nodes > MAX_MOTIF_NODES:
            raise ValueError(f"motif SVG has too many nodes (max {MAX_MOTIF_NODES})")
        tag = _tag(element)
        if tag == "path":
            paths += 1
            if paths > MAX_MOTIF_PATHS:
                raise ValueError(f"motif SVG has too many paths (max {MAX_MOTIF_PATHS})")
            data = element.get("d", "")
            commands = len(_PATH_COMMAND.findall(data))
            path_commands += commands
            geometry_tokens += commands + len(_NUMBER_TOKEN.findall(data))
            if path_commands > MAX_MOTIF_PATH_COMMANDS:
                raise ValueError(
                    f"motif SVG has too many path commands (max {MAX_MOTIF_PATH_COMMANDS})"
                )
        elif tag in {"polygon", "polyline"}:
            geometry_tokens += len(_NUMBER_TOKEN.findall(element.get("points", "")))
        if geometry_tokens > MAX_MOTIF_GEOMETRY_TOKENS:
            raise ValueError(
                f"motif SVG geometry is too complex (max {MAX_MOTIF_GEOMETRY_TOKENS} tokens)"
            )
        stack.extend((child, depth + 1) for child in reversed(list(element)))


def _norm_color(value: str) -> str | None:
    """concrete paint의 비교 키, 또는 슬롯 없는 paint(none/url(#…))는 None.

    currentColor는 concrete로 취급 — 단독이면 단색(s0), concrete와 섞이면 자체 슬롯.
    """
    low = value.strip().lower()
    if low == "none" or low.startswith("url("):
        return None
    return low


def _paint_attrs(children: list[ET.Element]) -> Iterator[tuple[ET.Element, str, str]]:
    """(노드, 속성, 값) — fill 먼저 stroke, DFS 최초 등장순. 읽기/재색/슬롯화가 공유하는 순회."""
    for child in children:
        for node in child.iter():
            for attr in ("fill", "stroke"):
                value = node.get(attr)
                if value is not None:
                    yield node, attr, value


def _distinct_colors(children: list[ET.Element]) -> list[str]:
    order: list[str] = []
    for _node, _attr, value in _paint_attrs(children):
        norm = _norm_color(value)
        if norm is not None and norm not in order:
            order.append(norm)
    return order


def _hex_rgb(color: str) -> tuple[int, int, int] | None:
    c = color.strip()
    return hex_to_rgb(c) if is_hex_color(c) else None


def _quantize_colors(children: list[ET.Element], max_slots: int) -> None:
    """concrete 색을 max_slots 이하로 결정론적 융합 — 최근접 RGB 두 hex 반복 병합.

    동점은 hex 사전순(작은 hex가 대표). hex 아닌 paint(currentColor)는 측정 불가라 병합
    불가 — 이것 때문에 예산 초과가 남으면 ValueError(재생성 트리거). in-place 변형.
    """
    distinct = _distinct_colors(children)
    if len(distinct) <= max_slots:
        return
    rgb = {c: _hex_rgb(c) for c in distinct}
    rep = {c: c for c in distinct}
    unmergeable = sum(1 for c in distinct if rgb[c] is None)
    active = sorted(c for c in distinct if rgb[c] is not None)
    while unmergeable + len(active) > max_slots and len(active) >= 2:
        best: tuple[int, str, str] | None = None  # (거리, keep, drop)
        for i in range(len(active)):
            for j in range(i + 1, len(active)):
                a, b = active[i], active[j]  # a < b (active 정렬됨)
                ra, rb = rgb[a], rgb[b]
                assert ra is not None and rb is not None  # active는 hex만 담는다
                dist = (ra[0] - rb[0]) ** 2 + (ra[1] - rb[1]) ** 2 + (ra[2] - rb[2]) ** 2
                cand = (dist, a, b)
                if best is None or cand < best:
                    best = cand
        assert best is not None  # len(active) >= 2 이므로 최소 한 쌍이 존재
        _, keep, drop = best
        for color, representative in rep.items():
            if representative == drop:
                rep[color] = keep
        active.remove(drop)
    if unmergeable + len(active) > max_slots:
        raise ValueError(
            f"motif has {len(distinct)} colors that cannot be quantized to "
            f"{max_slots} slots (too many non-hex paints)"
        )
    for node, attr, value in _paint_attrs(children):
        norm = _norm_color(value)
        if norm is not None and rep.get(norm, norm) != norm:
            node.set(attr, rep[norm])


def _slotize_colors(children: list[ET.Element]) -> tuple[str, ...]:
    """concrete fill/stroke를 슬롯 토큰으로 치환하고 color_slots 반환 (DFS 최초 등장순).

    ≤1색 → 전부 currentColor + ("s0",)(단색 레거시 유지). ≥2색 → 각 색을 s0,s1,… 토큰으로.
    """
    order = _distinct_colors(children)
    if len(order) <= 1:
        for node, attr, value in _paint_attrs(children):
            if _norm_color(value) is not None:
                node.set(attr, "currentColor")
        return ("s0",)
    token = {color: f"s{i}" for i, color in enumerate(order)}
    for node, attr, value in _paint_attrs(children):
        norm = _norm_color(value)
        if norm is not None:
            node.set(attr, token[norm])
    return tuple(f"s{i}" for i in range(len(order)))


def _standalone_preview_svg(
    inner: str,
    *,
    bbox: BBox,
    color_slots: tuple[str, ...],
    preview_colors: list[str],
    inherited_color: str,
) -> str:
    """Make normalized input geometry independently previewable and safely re-importable.

    Multi-color normalized geometry contains internal slot tokens (s0, s1, ...), not CSS
    colors. Deterministic concrete colors preserve slot order on the next normalization pass;
    slotification then recreates the original content-hash input exactly.
    """

    visible = inner
    if len(color_slots) > 1:
        for index, slot in enumerate(color_slots):
            # Restore a safe concrete preview paint. Slotification on re-import maps the same
            # first-occurrence order back to s0/s1, so colors do not enter motif identity.
            color = html.escape(preview_colors[index], quote=True)
            visible = visible.replace(f'fill="{slot}"', f'fill="{color}"')
            visible = visible.replace(f'stroke="{slot}"', f'stroke="{color}"')
    root_color = preview_colors[0] if len(preview_colors) == 1 else inherited_color
    if root_color.casefold() == "currentcolor":
        root_color = inherited_color
    bx, by, bx2, by2 = bbox
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'color="{html.escape(root_color, quote=True)}" '
        f'viewBox="{fmt(bx)} {fmt(by)} {fmt(bx2 - bx)} {fmt(by2 - by)}">'
        f"{visible}</svg>"
    )


def _edge_seam(image) -> float:
    """맞물리는 반대편 가장자리 픽셀의 채널별 평균 절대차 최대값 — 0에 가까울수록 seam 없음."""
    width, height = image.size
    px = image.load()

    def mean_abs(pairs: Iterator[tuple[tuple[int, ...], tuple[int, ...]]]) -> float:
        total = count = 0
        for a, b in pairs:
            for ca, cb in zip(a, b, strict=False):
                total += abs(int(ca) - int(cb))
                count += 1
        return total / count if count else 0.0

    seam_x = mean_abs((px[0, y], px[width - 1, y]) for y in range(height))
    seam_y = mean_abs((px[x, 0], px[x, height - 1]) for x in range(width))
    return max(seam_x, seam_y)


def _render_gate(motif: NormalizedMotif, *, edge_seam_tol: float) -> None:
    """렌더 기반 Tier1 검사 — 렌더 실패 또는 선언 bbox 오버플로(edge_seam 초과)를 거부.

    best-effort: SVG 렌더러가 없으면 no-op(librsvg는 하드 의존이 아님). 모티프는 변형하지 않아
    생성 바이트 결정론이 유지된다.
    """
    import io
    from shutil import which

    if not (which("rsvg-convert") or which("resvg")):
        return  # 렌더러 없음 — 렌더 의존 검사 skip

    from PIL import Image

    from worker.render.raster import RasterError, rasterize_svg

    size = float(_GATE_RENDER_MM)
    scale = size * (1.0 - 2.0 * _GATE_MARGIN_FRAC)
    transform = f"translate({fmt(size / 2.0)} {fmt(size / 2.0)}) scale({fmt(scale)})"
    symbols = slot_render_symbols(cast(MotifDef, motif))
    defs = "".join(symbol for _, symbol in symbols)
    body = "".join(
        f'<use href="#{sym_id}" color="#000000" transform="{transform}"/>' for sym_id, _ in symbols
    )
    document = (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{fmt(size)}mm" height="{fmt(size)}mm" viewBox="0 0 {fmt(size)} {fmt(size)}">'
        f"<defs>{defs}</defs>{body}</svg>"
    )
    try:
        png, _media = rasterize_svg(document, width_mm=size, dpi=_GATE_RENDER_DPI)
    except RasterError as exc:
        raise ValueError(f"motif failed to render: {exc}") from exc
    image = Image.open(io.BytesIO(png)).convert("RGBA")
    seam = _edge_seam(image)
    if seam > edge_seam_tol:
        raise ValueError(
            f"motif geometry overflows its declared bbox (edge_seam {seam:.2f} > {edge_seam_tol})"
        )


def normalize_motif_svg(
    raw_svg: str,
    *,
    id_prefix: str = "recraft",
    max_color_slots: int | None = None,
    max_aspect_ratio: float = 20.0,
    edge_seam_tol: float = 2.0,
    render_check: bool = True,
) -> NormalizedMotif:
    """authored/Recraft SVG를 모티프 인테이크 계약으로 정규화 (worker-motifs.md §1)."""
    if len(raw_svg.encode("utf-8")) > MAX_MOTIF_SVG_BYTES:
        raise ValueError(f"motif SVG exceeds {MAX_MOTIF_SVG_BYTES} bytes")
    root = sanitize.parse_svg_tree(raw_svg)
    sanitize._validate_tree(root)  # allowlist — filter/raster image/외부 href 거부
    _validate_intake_complexity(root)

    _validate_frame(root)  # 작성자 프레임 온전성

    children = list(root)
    if not _has_drawable(children):
        raise ValueError("motif SVG has no drawable geometry")

    from worker.motifs import geometry as geom

    bbox = geom.bbox_of(children)
    if bbox is None:
        raise ValueError("motif SVG has no measurable geometry")
    bx, by, bx2, by2 = bbox
    bw, bh = bx2 - bx, by2 - by
    extent = max(bw, bh)
    if extent <= 0:
        raise ValueError("motif SVG geometry has zero extent")
    min_side = min(bw, bh)
    if min_side <= 0:
        raise ValueError("motif SVG geometry is degenerate (a zero-width axis)")
    if extent / min_side > max_aspect_ratio:
        raise ValueError(
            f"motif SVG bbox aspect ratio {extent / min_side:.1f} exceeds max "
            f"{max_aspect_ratio} (too thin/elongated)"
        )
    scale = 1.0 / extent
    tx = -(bx + bw / 2.0) * scale
    ty = -(by + bh / 2.0) * scale

    if max_color_slots is not None:
        _quantize_colors(children, max_color_slots)
    preview_colors = _distinct_colors(children)
    inherited_color = root.get("color", "#111111")
    if inherited_color.casefold() in {"currentcolor", "inherit"}:
        inherited_color = "#111111"
    color_slots = _slotize_colors(children)
    inner = "".join(ET.tostring(child, encoding="unicode") for child in children)
    geometry = f'<g transform="translate({fmt(tx)} {fmt(ty)}) scale({fmt(scale)})">{inner}</g>'

    motif_id = id_prefix + "-" + hashlib.sha256(geometry.encode("utf-8")).hexdigest()[:12]
    symbol = f'<symbol id="motif-{motif_id}" overflow="visible">{geometry}</symbol>'
    preview_svg = _standalone_preview_svg(
        inner,
        bbox=bbox,
        color_slots=color_slots,
        preview_colors=preview_colors,
        inherited_color=inherited_color,
    )
    if len(symbol.encode("utf-8")) > MAX_MOTIF_SVG_BYTES:
        raise ValueError(f"normalized motif symbol exceeds {MAX_MOTIF_SVG_BYTES} bytes")
    if len(preview_svg.encode("utf-8")) > MAX_MOTIF_SVG_BYTES:
        raise ValueError(f"normalized motif preview exceeds {MAX_MOTIF_SVG_BYTES} bytes")
    motif = NormalizedMotif(
        id=motif_id,
        symbol=symbol,
        color_slots=color_slots,
        preview_svg=preview_svg,
    )
    if render_check:
        _render_gate(motif, edge_seam_tol=edge_seam_tol)
    return motif

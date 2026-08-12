"""SVG → 모티프 인테이크 계약 정규화 (worker-motifs.md §1·§2).

파이프라인: allowlist 파싱·검증 → 프레임 검증 → 루트 presentation 래핑 → paint 정규화
→ tight bbox 프레이밍 → `<g>` 래핑 + content-hash id → (선택) render gate.

정규화된 모티프는 항상 bbox `(-0.5,-0.5,0.5,0.5)`, anchor `(0,0)`. content-hash는
구체 색을 포함한 geometry에서 뽑으므로 도형과 색이 모두 같을 때만 같은 id다.

# ponytail: 자식 `id`는 네임스페이스를 붙이지 않는다. 서로 다른 두 모티프가 같은 defs id를
# 쓰면 한 문서에 함께 등록될 때 `<use href="#id">`가 상대 쪽을 가리킬 수 있다. 알려진 상한이며
# 고치지 않는다 — id를 다시 쓰면 preview_svg를 재정규화해도 같은 id가 나온다는 멱등 계약이
# 깨진다. 실사용 모티프는 defs/use를 거의 쓰지 않아 충돌 확률이 낮다.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from collections.abc import Iterator
from dataclasses import dataclass

import svg_safety as sanitize

from worker.engine.determinism import stable_digest
from worker.engine.units import fmt

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
_RGB_RE = re.compile(r"rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)", re.IGNORECASE)
_HEX_DIGITS = "0123456789abcdef"

# defs 밖에서 실제로 그려지는 요소.
_RENDERABLE = frozenset({"path", "polygon", "polyline", "rect", "circle", "ellipse", "line", "use"})


@dataclass(frozen=True)
class NormalizedMotif:
    """MotifDef 호환 필드(compose가 소비) — facet 메타는 store가 별도로 받는다."""

    id: str
    symbol: str
    bbox_mm: BBox = _UNIT_BBOX
    anchor: Anchor = _ORIGIN
    # Standalone, importable document showing the exact concrete-color geometry that produced
    # this identity. Re-normalizing it must recover the same id and symbol.
    preview_svg: str = ""


def _tag(el: ET.Element) -> str:
    return el.tag.rsplit("}", 1)[-1].lower() if isinstance(el.tag, str) else ""


# 렌더에 아무 영향이 없는 편집기·생성기 boilerplate. 허용 목록(svg_safety)을 넓히는 대신
# 인테이크에서 떼어낸다 — 외부 생성기가 흔히 붙이는 이 넷을 그대로 두면
# 거부하면 우리 자신의 출력물조차 모티프로 다시 못 들여온다.
_INERT_TAGS = frozenset({"metadata", "title", "desc"})
_INERT_ATTRS = frozenset({"version", "preserveAspectRatio", "space", "xml:space"})
# style은 fill/stroke/url을 실어 색을 바꿀 수 있어 무조건 버리면 조용히 그림이 달라진다.
# 그런 토큰이 없을 때만(예: display:block) 떼고, 있으면 allowlist 거부에 맡긴다.
_PAINTING_STYLE = re.compile(
    r"url\(|fill|stroke|color|paint|background|image|display\s*:\s*none", re.I
)


def _drop_inert_wrappers(root: ET.Element) -> None:
    for parent in (root, *root.iter()):
        for child in [el for el in list(parent) if _tag(el) in _INERT_TAGS]:
            parent.remove(child)
    for el in (root, *root.iter()):
        for raw_name in list(el.attrib):
            name = raw_name.rsplit("}", 1)[-1]
            if name in _INERT_ATTRS:
                del el.attrib[raw_name]
            elif name == "style" and not _PAINTING_STYLE.search(el.attrib[raw_name]):
                del el.attrib[raw_name]


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


def rgb_to_hex(value: str) -> str | None:
    """`rgb()`/`rgba()` → `#rrggbb`(알파는 버린다). 그 형식이 아니면 None."""
    match = _RGB_RE.match(value.strip())
    if not match:
        return None
    r, g, b = (max(0, min(255, round(float(channel)))) for channel in match.groups())
    return f"#{r:02x}{g:02x}{b:02x}"


def canonical_paint(value: str) -> str:
    """paint 한 값을 소문자 6/8자리 hex 또는 `none`으로 확정 — 다른 표기는 거부.

    `red`/`rgb(255,0,0)`/`#F00`/`#FF0000`이 전부 다른 content-hash가 되지 않게 하나로 접는다.
    named color·Pantone spot은 우리가 hex를 확정할 수 없으므로 거부하고, `url(#...)`는
    gradient·pattern paint server라 모티프에 존재할 수 없으므로 거부한다(계약 층 차단).
    """
    low = value.strip().casefold()
    if low in {"none", "transparent"}:
        return "none"
    if low.startswith("#"):
        digits = low[1:]
        if len(digits) in {3, 4}:
            digits = "".join(c * 2 for c in digits)
        if len(digits) not in {6, 8} or digits.strip(_HEX_DIGITS):
            raise ValueError(f"motif paint {value!r} is not a valid hex color")
        return "#" + digits
    hexed = rgb_to_hex(low)
    if hexed is None:
        raise ValueError(
            f"motif paint {value!r} must be a hex color, rgb()/rgba(), or none "
            "(named colors and url() paint servers are not allowed)"
        )
    return hexed


def _canonical_color(value: str | None, inherited: str) -> str:
    text = (value or "").strip()
    if text.casefold() in {"", "currentcolor", "inherit"}:
        return inherited
    return canonical_paint(text)


def _canonicalize_paints(children: list[ET.Element], root_color: str | None) -> None:
    """루트 `<svg>`가 버려지기 전에 상속 currentColor를 풀고 모든 paint를 정규 hex로 접는다.

    생성·시드 SVG는 보통 이미 hex지만, 업로드 문서는 루트 `color` 상속이나 `rgb()`·단축 hex를
    실어 온다. 여기서 확정해야 같은 그림이 표기 차이만으로 다른 모티프가 되지 않고, 나중에
    UI 색이 저장된 모티프를 바꾸지도 못한다.
    """

    fallback = _canonical_color(root_color, "#111111")

    def visit(node: ET.Element, inherited: str) -> None:
        raw_color = node.get("color")
        local = _canonical_color(raw_color, inherited)
        if raw_color is not None:
            node.set("color", local)
        for attr in ("fill", "stroke"):
            value = node.get(attr)
            if value is not None:
                node.set(attr, _canonical_color(value, local))
        for child in node:
            visit(child, local)

    for child in children:
        visit(child, fallback)


def _wrap_root_presentation(root: ET.Element) -> list[ET.Element]:
    """루트 `<svg>`의 presentation 속성을 자식들을 감싸는 `<g>` 하나로 옮긴다.

    자식만 취하고 루트를 버리면 루트에 걸린 fill/stroke가 통째로 사라진다 — `<svg fill="#c0445a">`
    안의 원은 검은 원이 되고, `<svg stroke="#000" fill="none">`의 선은 아예 보이지 않는다.
    자식마다 복사하지 않고 그룹으로 감싸는 이유는 opacity가 그룹 단위 합성이기 때문이다.
    """
    children = list(root)
    inherited = {
        name: value
        for name in ("fill", "stroke", "stroke-width", "opacity")
        if (value := root.get(name)) is not None
    }
    if not inherited:
        return children
    group = ET.Element("g", inherited)
    group.extend(children)
    for child in children:
        root.remove(child)
    root.append(group)
    return [group]


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
    document = (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{fmt(size)}mm" height="{fmt(size)}mm" viewBox="0 0 {fmt(size)} {fmt(size)}">'
        f'<defs>{motif.symbol}</defs><use href="#motif-{motif.id}" transform="{transform}"/>'
        "</svg>"
    )
    try:
        png, _media = rasterize_svg(document, width_mm=size, dpi=_GATE_RENDER_DPI)
    except RasterError as exc:
        raise ValueError(f"motif failed to render: {exc}") from exc
    image = Image.open(io.BytesIO(png)).convert("RGBA")
    if image.getchannel("A").getbbox() is None:
        # 완전 투명 래스터는 seam이 0이라 아래 검사를 그냥 통과한다 — 아무것도 안 그리는
        # 모티프(예: fill/stroke가 전부 none)를 여기서 명시적으로 거부한다.
        raise ValueError("motif renders nothing (the rasterized motif is fully transparent)")
    seam = _edge_seam(image)
    if seam > edge_seam_tol:
        raise ValueError(
            f"motif geometry overflows its declared bbox (edge_seam {seam:.2f} > {edge_seam_tol})"
        )


def normalize_motif_svg(
    raw_svg: str,
    *,
    id_prefix: str,
    max_aspect_ratio: float = 20.0,
    edge_seam_tol: float = 2.0,
    render_check: bool = True,
) -> NormalizedMotif:
    """SVG를 모티프 인테이크 계약으로 정규화 (worker-motifs.md §1)."""
    if len(raw_svg.encode("utf-8")) > MAX_MOTIF_SVG_BYTES:
        raise ValueError(f"motif SVG exceeds {MAX_MOTIF_SVG_BYTES} bytes")
    root = sanitize.parse_svg_tree(raw_svg)
    _drop_inert_wrappers(root)
    sanitize._validate_tree(root)  # allowlist — filter/raster image/외부 href 거부
    _validate_intake_complexity(root)

    _validate_frame(root)  # 작성자 프레임 온전성

    children = _wrap_root_presentation(root)
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

    _canonicalize_paints(children, root.get("color"))
    inner = "".join(ET.tostring(child, encoding="unicode") for child in children)
    geometry = f'<g transform="translate({fmt(tx)} {fmt(ty)}) scale({fmt(scale)})">{inner}</g>'

    motif_id = id_prefix + "-" + stable_digest(geometry, 12)
    symbol = f'<symbol id="motif-{motif_id}" overflow="visible">{geometry}</symbol>'
    # 저장 symbol과 같은 concrete geometry의 standalone 문서 — 재-import하면 같은 id를 회복한다.
    preview_svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{fmt(bx)} {fmt(by)} {fmt(bw)} {fmt(bh)}">{inner}</svg>'
    )
    if len(symbol.encode("utf-8")) > MAX_MOTIF_SVG_BYTES:
        raise ValueError(f"normalized motif symbol exceeds {MAX_MOTIF_SVG_BYTES} bytes")
    if len(preview_svg.encode("utf-8")) > MAX_MOTIF_SVG_BYTES:
        raise ValueError(f"normalized motif preview exceeds {MAX_MOTIF_SVG_BYTES} bytes")
    motif = NormalizedMotif(
        id=motif_id,
        symbol=symbol,
        preview_svg=preview_svg,
    )
    if render_check:
        _render_gate(motif, edge_seam_tol=edge_seam_tol)
    return motif

"""배치형(panel) 합성 — 블레이드에 한 번만 놓이는 요소의 SVG (worker-engine.md §2b).

타일(`<pattern>`)과 별개의 문서다. seamless 클론·불변식을 적용하지 않고, 배경은 투명이다.
소비자(store TieCanvas)가 실루엣마다 블레이드 프레임을 아트 박스에
사상해 무늬 위·명암 아래에 한 번 얹는다.
"""

from functools import lru_cache

from svg_safety import parse_svg_tree, sanitize_svg

from worker.engine.intent import Intent, PanelElement, PanelMotif
from worker.engine.palette import Palette
from worker.engine.primitives import escape_attr
from worker.engine.units import fmt
from worker.motifs import geometry
from worker.motifs.registry import MotifCatalog, MotifDef, resolve_motif

# 블레이드 프레임 viewBox — x 0..1000(블레이드 폭), y는 어깨선 1000·끝 ≈1500. 위로는 실사 컷의
# 매듭 아래(어깨 위 블레이드 폭 ~5.5배)까지 담는다. 소비자의 사상과 결속된 상수다.
PANEL_VIEWBOX = (0.0, -4600.0, 1000.0, 6200.0)
# 로고는 사용자가 올린 아무 비율이나 들어온다 — 면적 기준 크기를 이 배수로 자른다
# (store `emblemBox`의 maxW·maxH와 같은 비).
_LOGO_MAX_W = 2.0
_LOGO_MAX_H = 1.5


@lru_cache(maxsize=256)
def _symbol_extent(symbol: str) -> tuple[float, float, float, float]:
    """모티프 실제 외곽(cx, cy, w, h) — 정규화는 긴 변만 1로 맞추므로 가로세로 비는 도형에 있다."""
    root = parse_svg_tree(f'<svg xmlns="http://www.w3.org/2000/svg">{symbol}</svg>')
    node = next((el for el in root.iter() if el.tag == "symbol"), root)
    box = geometry.bbox_of(list(node))
    if box is None or box[2] <= box[0] or box[3] <= box[1]:
        return 0.0, 0.0, 1.0, 1.0
    x0, y0, x1, y1 = box
    return (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0


def _motif_transform(element: PanelMotif, motif: MotifDef) -> str:
    cx, cy, bw, bh = _symbol_extent(motif.symbol)
    ratio = bw / bh
    width = element.size * ratio**0.5
    height = element.size / ratio**0.5
    if element.role == "logo":
        shrink = min(1.0, _LOGO_MAX_W * element.size / width, _LOGO_MAX_H * element.size / height)
        width, height = width * shrink, height * shrink
    x, y = element.at
    if element.anchor == "bottom_right":
        x, y = x - width / 2, y - height / 2
    return (
        f"translate({fmt(x)} {fmt(y)}) rotate({fmt(element.rotation)}) "
        f"scale({fmt(width / bw)}) translate({fmt(-cx)} {fmt(-cy)})"
    )


def _points(points: list[tuple[float, float]]) -> str:
    return " ".join(f"{fmt(x)},{fmt(y)}" for x, y in points)


def _render_element(
    element: PanelElement,
    color: str,
    motifs: MotifCatalog | None,
    symbol_defs: dict[str, str],
) -> str:
    if element.type == "motif":
        motif = resolve_motif(element.motif_id, motifs)
        symbol_defs.setdefault(f"motif-{motif.id}", motif.symbol)
        return f'<use href="#motif-{motif.id}" transform="{_motif_transform(element, motif)}"/>'
    if element.type == "region":
        return f'<polygon points="{_points(element.points)}" fill="{color}"/>'
    stroke = f'fill="none" stroke="{color}" stroke-width="{fmt(element.width)}"'
    if element.type == "line":
        line = f'<polyline points="{_points(element.points)}" {stroke}/>'
        if element.end_dot is None:
            return line
        x, y = element.points[-1]
        dot = f'<circle cx="{fmt(x)}" cy="{fmt(y)}" r="{fmt(element.end_dot / 2)}" fill="{color}"/>'
        return line + dot
    (x0, y0), *rest = element.points
    segments = " ".join(
        "C " + " ".join(f"{fmt(x)} {fmt(y)}" for x, y in rest[i : i + 3])
        for i in range(0, len(rest), 3)
    )
    return f'<path d="M {fmt(x0)} {fmt(y0)} {segments}" {stroke}/>'


def compose_panel(
    intent: Intent,
    palette: Palette,
    colorway_id: str | None = None,
    motifs: MotifCatalog | None = None,
) -> str | None:
    """panel이 없으면 None. 같은 intent+colorway → byte-identical."""
    if not intent.panel:
        return None
    symbol_defs: dict[str, str] = {}
    body = "".join(
        _render_element(
            element,
            ""
            if element.type == "motif"
            else escape_attr(palette.resolve_color(element.color, colorway_id)),
            motifs,
            symbol_defs,
        )
        for element in intent.panel
    )
    x, y, w, h = PANEL_VIEWBOX
    defs = f"<defs>{''.join(symbol_defs.values())}</defs>" if symbol_defs else ""
    return sanitize_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{fmt(x)} {fmt(y)} {fmt(w)} {fmt(h)}">{defs}{body}</svg>'
    )


def panel_logo(raw: object) -> dict | None:
    """raw intent의 panel 로고 요소(있으면 하나) — api·patch가 validate 없이 찾는다."""
    panel = raw.get("panel") if isinstance(raw, dict) else None
    for element in panel if isinstance(panel, list) else ():
        if isinstance(element, dict) and element.get("type") == "motif":
            if element.get("role") == "logo":
                return element
    return None

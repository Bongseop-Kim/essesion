"""모티프 기하학 커버리지 마스크 — 실 인레이 대상 픽셀 (worker-pipeline.md §2).

디자인과 같은 토폴로지의 **마스크 문서**를 한 번 래스터해 얻는다: 팔레트 슬롯은 전부
검정, 모티프 심볼의 paint는 전부 흰색. 레이어 z-order·opacity가 그대로 적용되므로 위
레이어에 가려진 모티프 픽셀은 자연히 검정으로 덮이고, 경계 안티에일리어싱은 회색
커버리지로 남는다(이진화는 inlay.MASK_THRESHOLD).

색 대비에 의존하지 않는 것이 요점이다 — "모티프 색 고정" 계약 아래에서 모티프 색은
팔레트와 무관하므로, 바탕과 같은 색이거나 팔레트 색과 겹치면 렌더 픽셀 차이 기반
마스크는 실루엣을 통째로 잃거나 두 조각으로 쪼갠다. 마스크 문서는 제품 산출물이 아닌
내부 중간물이라 paint 치환은 결정론 계약(같은 intent+seed → byte-identical 디자인
SVG)과 무관하다.
"""

import io
import xml.etree.ElementTree as ET
from dataclasses import replace

import svg_safety
from PIL import Image

from worker.engine.composition import compose
from worker.engine.intent import Intent
from worker.engine.palette import DEFAULT_COLORWAY_ID, ColorSlot, Colorway, Palette
from worker.motifs.registry import MotifCatalog, MotifDef, resolve_motif
from worker.render import raster

GROUND = "#000000"
INK = "#ffffff"
_NO_PAINT = frozenset({"none", "transparent"})
# SVG 초기값 — 속성이 없는 요소도 채워지므로 상속 시작점을 명시한다.
_DEFAULT_FILL = "#000000"
_DEFAULT_STROKE = "none"


def _resolved(value: str | None, inherited: str) -> str:
    token = (value or "").strip().lower()
    return inherited if token in ("", "inherit") else token


def _repaint(node: ET.Element, *, fill: str, stroke: str) -> None:
    """paint를 흰색으로 치환하되 `none`은 보존 — 획 전용 도형을 채워버리지 않는다."""
    fill = _resolved(node.get("fill"), fill)
    stroke = _resolved(node.get("stroke"), stroke)
    node.set("fill", "none" if fill in _NO_PAINT else INK)
    if stroke not in _NO_PAINT:
        node.set("stroke", INK)
    for child in node:
        _repaint(child, fill=fill, stroke=stroke)


def mask_motif(motif: MotifDef) -> MotifDef:
    """geometry는 그대로 두고 paint만 흰색으로 바꾼 심볼 사본."""
    root = svg_safety.parse_svg_tree(motif.symbol)
    _repaint(root, fill=_DEFAULT_FILL, stroke=_DEFAULT_STROKE)
    return replace(motif, symbol=ET.tostring(root, encoding="unicode"))


def motif_coverage_mask(
    intent: Intent,
    palette: Palette,
    *,
    dpi: int,
    tile_mm: float,
    motifs: MotifCatalog | None = None,
) -> Image.Image:
    """가시 모티프 픽셀의 L 마스크(0=바탕, 255=완전 커버). compose+rasterize 1회."""
    slot_ids = sorted(palette.slot_ids())
    mask_palette = Palette(
        slots=tuple(ColorSlot(id=slot, hex=GROUND) for slot in slot_ids),
        colorways=(Colorway(id=DEFAULT_COLORWAY_ID, mapping=dict.fromkeys(slot_ids, GROUND)),),
    )
    mask_motifs = {
        layer.params.motif_id: mask_motif(resolve_motif(layer.params.motif_id, motifs))
        for layer in intent.layers
        if layer.type == "motif"
    }

    svg = compose(intent, mask_palette, DEFAULT_COLORWAY_ID, mask_motifs)
    png, _ = raster.rasterize_svg(svg, fmt="png", width_mm=tile_mm, dpi=dpi)
    rendered = Image.open(io.BytesIO(png)).convert("RGBA")
    # 어떤 레이어도 덮지 않은 픽셀은 투명하다 — 검정 위에 합성해야 경계 AA가 커버리지
    # 비율 그대로 남는다(알파를 그냥 버리면 반투명 가장자리가 완전 불투명으로 읽힌다).
    ground = Image.new("RGBA", rendered.size, (0, 0, 0, 255))
    return Image.alpha_composite(ground, rendered).convert("L")

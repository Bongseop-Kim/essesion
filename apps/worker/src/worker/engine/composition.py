"""레이어 합성 — <symbol>+<use>+<pattern> 고정 토폴로지 (worker-engine.md §2).

원본과 byte-identical: 문서는 width=height=tile_mm(단일 라인, XML 선언 없음),
레이어는 (z_order, id) 정렬, 심볼은 최초 등장 순 defs 등록.
"""

from typing import Any

from worker.config import get_settings
from worker.engine.intent import Intent, Layer, MotifLayer
from worker.engine.palette import Palette
from worker.engine.placement import Instance, place
from worker.engine.primitives import build_primitive, escape_attr
from worker.engine.seamless import clone_instances
from worker.engine.units import fmt
from worker.motifs.registry import MotifCatalog, MotifDef, resolve_motif, slot_render_symbols
from worker.render.sanitize import sanitize_svg


def render_svg_document(
    body: str, width_mm: float, height_mm: float | None = None, defs: str = ""
) -> str:
    height = height_mm if height_mm is not None else width_mm
    defs_block = f"<defs>{defs}</defs>" if defs else ""
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{fmt(width_mm)}mm" height="{fmt(height)}mm" '
        f'viewBox="0 0 {fmt(width_mm)} {fmt(height)}">'
        f"{defs_block}{body}"
        "</svg>"
    )


def compose(
    intent: Intent,
    palette: Palette,
    colorway_id: str | None = None,
    motifs: MotifCatalog | None = None,
) -> str:
    tile = intent.canvas.tile_mm
    layers = sorted(intent.layers, key=lambda layer: (layer.z_order, layer.id))

    hosts: dict[str, Any] = {
        layer.id: build_primitive(layer, tile)
        for layer in layers
        if layer.type in ("background", "stripe")
    }

    symbol_defs: dict[str, str] = {}  # 삽입순 유지 — 최초 등장 심볼 순서가 defs 순서
    fragments: list[str] = []
    for layer in layers:
        fragment = _render_layer(
            layer, hosts, palette, colorway_id, tile, symbol_defs, intent.seed, motifs
        )
        if not fragment:
            continue
        if layer.opacity != 1.0:
            fragment = f'<g opacity="{fmt(layer.opacity)}">{fragment}</g>'
        fragments.append(fragment)

    content = "".join(fragments)
    width = height = tile
    pattern = (
        '<pattern id="tile" patternUnits="userSpaceOnUse" '
        f'width="{fmt(width)}" height="{fmt(height)}">'
        f"{content}</pattern>"
    )
    defs = "".join(symbol_defs.values()) + pattern
    body = f'<rect x="0" y="0" width="{fmt(width)}" height="{fmt(height)}" fill="url(#tile)"/>'
    document = render_svg_document(body, width, height, defs=defs)

    # sanitize 재파싱(피크 메모리 2배) 전에 크기 캡
    size = len(document.encode("utf-8"))
    max_bytes = get_settings().max_svg_bytes
    if size > max_bytes:
        raise ValueError(f"composed SVG {size} bytes exceeds max_svg_bytes {max_bytes}")
    return sanitize_svg(document)


def _render_layer(
    layer: Layer,
    hosts: dict[str, Any],
    palette: Palette,
    colorway_id: str | None,
    tile: float,
    symbol_defs: dict[str, str],
    seed: int,
    motifs: MotifCatalog | None,
) -> str:
    if layer.type == "background":
        return hosts[layer.id].render(tile, palette, colorway_id)
    if layer.type == "stripe":
        return hosts[layer.id].render(palette, colorway_id)
    if layer.type == "motif":
        return _render_motif_layer(
            layer, hosts, palette, colorway_id, tile, symbol_defs, seed, motifs
        )
    raise ValueError(f"unsupported layer type: {layer.type!r}")


def _render_motif_layer(
    layer: MotifLayer,
    hosts: dict[str, Any],
    palette: Palette,
    colorway_id: str | None,
    tile: float,
    symbol_defs: dict[str, str],
    seed: int,
    motifs: MotifCatalog | None,
) -> str:
    placement = layer.placement
    if placement is None:
        raise ValueError(f"motif layer {layer.id!r} requires placement")
    host = None
    if placement.host_layer is not None:
        if placement.host_layer not in hosts:
            raise ValueError(
                f"motif layer {layer.id!r} references unknown host_layer {placement.host_layer!r}"
            )
        host = hosts[placement.host_layer]

    motif = resolve_motif(layer.params.motif_id, motifs)
    size_mm = layer.params.size_mm
    placed = place(layer, host, tile, seed)
    instances = clone_instances(placed, motif=motif, size_mm=size_mm, tile_mm=tile)

    # 멀티컬러: 슬롯별 심볼을 instance-major/slot-minor로 겹쳐 그림
    if layer.params.colors is not None:
        render_symbols = slot_render_symbols(motif)
        for sym_id, body in render_symbols:
            symbol_defs.setdefault(sym_id, body)
        slot_colors = [
            escape_attr(palette.resolve_color(layer.params.colors[slot], colorway_id))
            for slot in motif.color_slots
        ]
        uses: list[str] = []
        for inst in instances:
            transform = _instance_transform(motif, inst, size_mm)
            for (sym_id, _body), color in zip(render_symbols, slot_colors, strict=True):
                uses.append(f'<use href="#{sym_id}" color="{color}" transform="{transform}"/>')
        return "".join(uses)

    symbol_defs.setdefault(f"motif-{motif.id}", motif.symbol)
    color_slot = layer.params.color
    assert color_slot is not None  # _exactly_one_color_spec이 보장
    color = escape_attr(palette.resolve_color(color_slot, colorway_id))
    return "".join(
        f'<use href="#motif-{motif.id}" color="{color}" '
        f'transform="{_instance_transform(motif, inst, size_mm)}"/>'
        for inst in instances
    )


def _instance_transform(motif: MotifDef, inst: Instance, size_mm: float) -> str:
    """scale은 bbox extent에서 유도, anchor는 lane point에 정확히 놓인다(회전 피벗)."""
    min_x, min_y, max_x, max_y = motif.bbox_mm
    extent = max(max_x - min_x, max_y - min_y)
    scale = size_mm / extent
    parts = [
        f"translate({fmt(inst.x_mm)} {fmt(inst.y_mm)})",
        f"rotate({fmt(inst.rotation_deg)})",
        f"scale({fmt(scale)})",
    ]
    ax, ay = motif.anchor
    if ax != 0.0 or ay != 0.0:
        parts.append(f"translate({fmt(-ax)} {fmt(-ay)})")
    return " ".join(parts)

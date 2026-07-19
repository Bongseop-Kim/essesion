"""슬롯 세그멘테이션 + 모티프 마스크 파생 (worker-pipeline.md §2·§5.6).

라벨 전용 colorway로 한 번 래스터해 슬롯 인덱스 P 이미지를 얻는다. 모티프 레이어의
색 슬롯을 별칭(`__motif__{slot}`)으로 치환한 intent 사본을 함께 렌더하면 같은 한 번의
래스터에서 (1) 별칭 인덱스를 실슬롯으로 접은 full 세그먼트와 (2) 슬롯별 모티프 마스크를
동시에 파생할 수 있다 — 원본 seamless-tile의 motif-only 별도 렌더를 제거한 재설계.

엔진 Palette 불변식(모든 colorway가 전 슬롯을 매핑)상 기존 palette에 라벨 colorway를
덧댈 수 없어, 별칭 슬롯까지 포함한 **라벨 전용 Palette**를 새로 구성한다(colorway id는
`default`). 라벨색은 전체 라벨 슬롯 id를 정렬한 순서에 count 기반 균등 hue를 부여하고,
경계는 최근접 quantize(dither 없음)로 한 영역에 이산화한다.
"""

import colorsys
import io
from dataclasses import dataclass, field

from PIL import Image

from worker.engine.composition import compose
from worker.engine.intent import Intent
from worker.engine.palette import DEFAULT_COLORWAY_ID, ColorSlot, Colorway, Palette
from worker.motifs.registry import MotifCatalog
from worker.render import raster

_ALIAS_PREFIX = "__motif__"


@dataclass(frozen=True)
class Segmentation:
    """slot_index: 실슬롯 인덱스 P 이미지(0..n-1, sorted slot id 순).
    index_for: 실슬롯 id → 인덱스. motif_masks: 실슬롯 id → 가시 모티프 픽셀 L 마스크."""

    slot_index: Image.Image
    index_for: dict[str, int]
    motif_masks: dict[str, Image.Image] = field(default_factory=dict)


def _alias(slot: str) -> str:
    return f"{_ALIAS_PREFIX}{slot}"


def motif_slots(intent: Intent) -> set[str]:
    """모티프 레이어의 fill이 해석되는 팔레트 슬롯 id — 비모티프 레이어는 건너뜀."""
    slots: set[str] = set()
    for layer in intent.layers:
        if layer.type != "motif":
            continue
        if layer.params.color is not None:
            slots.add(layer.params.color)
        if layer.params.colors:
            slots.update(layer.params.colors.values())
    return slots


def _label_colors(n: int) -> list[tuple[int, int, int]]:
    """count에서 결정되는, 최대로 벌린 distinct RGB n개(전 채도·명도 균등 hue)."""
    out: list[tuple[int, int, int]] = []
    for i in range(n):
        r, g, b = colorsys.hsv_to_rgb(i / max(1, n), 1.0, 1.0)
        out.append((round(r * 255), round(g * 255), round(b * 255)))
    return out


def _rgb_hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def without_motif_layers(intent: Intent) -> Intent | None:
    """모티프 레이어를 제거한 base intent(재검증 없이 model_copy) — 없으면 None."""
    layers = [layer for layer in intent.layers if layer.type != "motif"]
    if not layers:
        return None
    return intent.model_copy(update={"layers": layers})


def _alias_motif_layers(intent: Intent, aliases: dict[str, str]) -> Intent:
    """모티프 레이어의 color/colors 슬롯 참조를 별칭 슬롯으로 치환한 사본."""
    layers = []
    for layer in intent.layers:
        if layer.type != "motif":
            layers.append(layer)
            continue
        params = layer.params
        if params.color is not None:
            new_params = params.model_copy(update={"color": aliases[params.color]})
        else:
            assert params.colors is not None
            new_params = params.model_copy(
                update={"colors": {k: aliases[v] for k, v in params.colors.items()}}
            )
        layers.append(layer.model_copy(update={"params": new_params}))
    return intent.model_copy(update={"layers": layers})


def mask_for(seg: Image.Image, index: int) -> Image.Image:
    """seg(P 이미지)의 픽셀 인덱스가 index인 곳은 흰색, 나머지 검정 (mode L)."""
    lut: list[int] = []
    for i in range(256):
        v = 255 if i == index else 0
        lut += [v, v, v]
    m = seg.copy()
    m.putpalette(lut)
    return m.convert("L")


def segment(
    intent: Intent,
    palette: Palette,
    *,
    dpi: int,
    tile_mm: float,
    split_motifs: bool,
    motifs: MotifCatalog | None = None,
) -> Segmentation:
    """라벨 렌더 1회로 슬롯 세그먼트를 얻는다. split_motifs면 별칭 슬롯으로 모티프
    마스크까지 파생한다."""
    real_slots = sorted(palette.slot_ids())
    real_index = {s: i for i, s in enumerate(real_slots)}

    split_slots = sorted(motif_slots(intent)) if split_motifs else []
    aliases: dict[str, str] = {}
    for slot in split_slots:
        alias = _alias(slot)
        assert alias not in palette.slot_ids(), f"alias {alias!r} collides with a real slot"
        aliases[slot] = alias

    label_ids = sorted(real_slots + list(aliases.values()))
    colors = _label_colors(len(label_ids))
    color_of = dict(zip(label_ids, colors, strict=True))
    label_index = {sid: i for i, sid in enumerate(label_ids)}

    label_slots = tuple(ColorSlot(id=sid, hex=_rgb_hex(color_of[sid])) for sid in label_ids)
    label_cw = Colorway(
        id=DEFAULT_COLORWAY_ID,
        mapping={sid: _rgb_hex(color_of[sid]) for sid in label_ids},
    )
    label_palette = Palette(slots=label_slots, colorways=(label_cw,))

    render_intent = _alias_motif_layers(intent, aliases) if aliases else intent
    svg = compose(render_intent, label_palette, DEFAULT_COLORWAY_ID, motifs)
    png, _ = raster.rasterize_svg(svg, fmt="png", width_mm=tile_mm, dpi=dpi)
    rgb = Image.open(io.BytesIO(png)).convert("RGB")

    pal_img = Image.new("P", (1, 1))
    flat = [c for sid in label_ids for c in color_of[sid]]
    flat += [0, 0, 0] * (256 - len(label_ids))
    pal_img.putpalette(flat)
    seg_full = rgb.quantize(palette=pal_img, dither=Image.Dither.NONE)

    # 별칭 인덱스를 실슬롯 인덱스로 접는 LUT — 별칭 픽셀은 원 슬롯 영역으로 흡수된다.
    alias_to_real = {alias: slot for slot, alias in aliases.items()}
    fold = list(range(256))
    for sid in label_ids:
        real = alias_to_real.get(sid, sid)
        fold[label_index[sid]] = real_index[real]
    folded = bytes(fold[b] for b in seg_full.tobytes())
    slot_index = Image.frombytes("P", seg_full.size, folded)

    motif_masks = {slot: mask_for(seg_full, label_index[aliases[slot]]) for slot in split_slots}
    return Segmentation(slot_index=slot_index, index_for=real_index, motif_masks=motif_masks)

"""배경·스트라이프 팔레트 슬롯 세그멘테이션 (worker-pipeline.md §2·§5.6).

라벨 전용 colorway로 한 번 래스터해 슬롯 인덱스 P 이미지를 얻는다. 모티프 레이어의
색은 심볼 자체에 고정되어 있으므로 이 모듈은 모티프 레이어를 제외한 intent만 다룬다.

엔진 Palette 불변식(모든 colorway가 전 슬롯을 매핑)상 기존 palette에 라벨 colorway를
덧댈 수 없어 **라벨 전용 Palette**를 새로 구성한다(colorway id는 `default`). 라벨색은
전체 라벨 슬롯 id를 정렬한 순서에 count 기반 균등 hue를 부여하고,
경계는 최근접 quantize(dither 없음)로 한 영역에 이산화한다.
"""

import colorsys
import io
from dataclasses import dataclass

from PIL import Image

from worker.engine.composition import compose
from worker.engine.intent import Intent
from worker.engine.palette import DEFAULT_COLORWAY_ID, ColorSlot, Colorway, Palette
from worker.render import raster


@dataclass(frozen=True)
class Segmentation:
    """slot_index: 슬롯 인덱스 P 이미지. index_for: 슬롯 id → 인덱스."""

    slot_index: Image.Image
    index_for: dict[str, int]


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


def mask_for(seg: Image.Image, index: int) -> Image.Image:
    """Return an L mask for one palette index in a segmented P image."""

    lut: list[int] = []
    for candidate in range(256):
        value = 255 if candidate == index else 0
        lut += [value, value, value]
    mask = seg.copy()
    mask.putpalette(lut)
    return mask.convert("L")


def segment(intent: Intent, palette: Palette, *, dpi: int, tile_mm: float) -> Segmentation:
    """라벨 렌더 1회로 배경·스트라이프 슬롯 세그먼트를 얻는다.

    호출자는 모티프 레이어를 제거한 intent를 넘긴다(without_motif_layers) — 카탈로그가
    필요 없는 이유다."""
    real_slots = sorted(palette.slot_ids())
    real_index = {s: i for i, s in enumerate(real_slots)}
    label_ids = real_slots
    colors = _label_colors(len(label_ids))
    color_of = dict(zip(label_ids, colors, strict=True))
    label_slots = tuple(ColorSlot(id=sid, hex=_rgb_hex(color_of[sid])) for sid in label_ids)
    label_cw = Colorway(
        id=DEFAULT_COLORWAY_ID,
        mapping={sid: _rgb_hex(color_of[sid]) for sid in label_ids},
    )
    label_palette = Palette(slots=label_slots, colorways=(label_cw,))

    svg = compose(intent, label_palette, DEFAULT_COLORWAY_ID)
    png, _ = raster.rasterize_svg(svg, fmt="png", width_mm=tile_mm, dpi=dpi)
    rgb = Image.open(io.BytesIO(png)).convert("RGB")

    pal_img = Image.new("P", (1, 1))
    flat = [c for sid in label_ids for c in color_of[sid]]
    flat += [0, 0, 0] * (256 - len(label_ids))
    pal_img.putpalette(flat)
    slot_index = rgb.quantize(palette=pal_img, dither=Image.Dither.NONE)
    return Segmentation(slot_index=slot_index, index_for=real_index)

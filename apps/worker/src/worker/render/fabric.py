"""fabric finalize — print(균일 weave) + yarn_dyed(영역별 weave·모티프 실 인레이·relief).

결정론: 동일 입력 → byte-identical PNG(Pillow·렌더러·에셋 핀 전제). 원본 seamless-tile의
기능 명세를 재현하되 compose+rasterize 호출 수를 최소화하도록 재설계했다
(worker-pipeline.md §2 "compose+rasterize 재실행 지점" — 승계 금지):

    print                     : 1회 (실색 디자인)
    yarn_dyed, 모티프 없음     : 1회 + (material_map ∨ relief>0 시) 라벨 1회
    yarn_dyed, 모티프          : R1 라벨(별칭 슬롯) + R2 base 실색 = 2회
                +material_map  : + R3 base 라벨 = 3회

원본의 "전체 실색 렌더"는 생략했다 — 실 가닥 색 소스는 R2(base 실색) 위에 모티프 마스크로
평탄 슬롯색을 합성한 이미지이며, yarn = 그 이미지 × twill-45다. 슬롯 경계 relief는 R1의
folded 세그먼트를 재사용한다(추가 렌더 없음).

원본 대비 의도적 차이 3건:
  ① 저불투명 모티프는 라벨 최근접 quantize로 흡수한다(원본은 motif-only 렌더의 alpha ≥ 24
     게이트). 별칭 슬롯이 지배하는 픽셀만 가닥이 된다.
  ② 스트라이프/배경에 가려진 모티프 픽셀에는 가닥을 그리지 않는다(원본은 그렸다 — 가려진
     실이 위로 새는 것을 개선). 별칭은 가시 모티프 픽셀에만 남기 때문이다.
  ③ weave 에셋 누락은 하드 에러다(원본은 평탄색 폴백). 에셋은 결정론 입력이므로 조용한
     폴백은 골든을 깨는 무결성 위험 — 명시적 실패가 옳다.

blocking(Pillow·subprocess) — async 핸들러에서는 run_in_threadpool로 호출.
"""

import io
from functools import lru_cache
from importlib.resources import files
from typing import Any

from PIL import Image, ImageChops

from worker.config import Settings
from worker.engine.composition import compose
from worker.engine.palette import hex_to_rgb
from worker.engine.units import mm_to_px
from worker.engine.validate import validate_intent
from worker.render import inlay, materials, raster
from worker.render import segment as segment_mod
from worker.render.inlay import MOTIF_WEAVE

DEFAULT_TEXTURE_STRENGTH = 2.4
DEFAULT_RELIEF_STRENGTH = 0.45
_MAX_INLAY_PIXELS = 20_000_000  # 모티프 인레이는 3× 슈퍼샘플·3×3 타일 — 픽셀 폭발 가드


class FabricError(ValueError):
    """잘못된 fabric 요청(unknown weave/colorway/slot 등). 영구 실패 — 라우트는 failed 기록."""


@lru_cache(maxsize=1)
def available_weaves() -> tuple[str, ...]:
    names = [
        item.name.removesuffix(".png")
        for item in files("worker.render.assets.fabric").iterdir()
        if item.name.endswith(".png")
    ]
    return tuple(sorted(names))


def _weave_bytes(weave: str) -> bytes:
    """에셋 접근 단일 접합부 — 테스트는 이 함수를 monkeypatch(+_weave_image.cache_clear)."""
    return (files("worker.render.assets.fabric") / f"{weave}.png").read_bytes()


@lru_cache(maxsize=8)
def _weave_image(weave: str) -> Image.Image:
    return Image.open(io.BytesIO(_weave_bytes(weave))).convert("RGB")


def _is_print_weave(weave: str) -> bool:
    return weave.startswith("twill")


def _tile_to(texture: Image.Image, size: tuple[int, int]) -> Image.Image:
    """정수 개 복제 후 목표 크기로 LANCZOS 리사이즈 — 부분 크롭 금지(seam 유지)."""
    tw, th = texture.size
    w, h = size
    nx = max(1, round(w / tw))
    ny = max(1, round(h / th))
    canvas = Image.new("RGB", (nx * tw, ny * th))
    for j in range(ny):
        for i in range(nx):
            canvas.paste(texture, (i * tw, j * th))
    if canvas.size != size:
        canvas = canvas.resize(size, Image.Resampling.LANCZOS)
    return canvas


def _apply_weave(design: Image.Image, weave: str, strength: float) -> Image.Image:
    tex = _tile_to(_weave_image(weave), design.size)
    if strength != 1.0:
        lut = [max(0, min(255, round(255 - (255 - v) * strength))) for v in range(256)]
        tex = tex.point(lut * 3)
    return ImageChops.multiply(design, tex)


def _render_design(intent, palette, colorway_id, *, dpi: int, tile_mm: float) -> Image.Image:
    svg = compose(intent, palette, colorway_id)
    png, _ = raster.rasterize_svg(svg, fmt="png", width_mm=tile_mm, dpi=dpi)
    return Image.open(io.BytesIO(png)).convert("RGB")


def _encode(out: Image.Image, dpi: int) -> bytes:
    buf = io.BytesIO()
    out.save(buf, "PNG", dpi=(dpi, dpi))
    return buf.getvalue()


def render_fabric(params: dict[str, Any], settings: Settings) -> bytes:
    intent_raw = params.get("intent")
    if not isinstance(intent_raw, dict):
        raise FabricError("finalize params require an `intent`")
    result = validate_intent(intent_raw)
    intent = result.intent
    palette = result.palette

    dpi = int(params.get("dpi") or settings.fabric_dpi)
    if dpi > settings.max_dpi:
        raise FabricError(f"dpi must be <= {settings.max_dpi}")

    method = params.get("production_method") or intent.production.method
    if method not in {"print", "yarn_dyed"}:
        raise FabricError("production_method must be print or yarn_dyed")

    weave = params.get("weave") or "twill-45"
    weaves = available_weaves()
    if weave not in weaves:
        raise FabricError(f"unknown weave {weave!r}; available: {list(weaves)}")

    colorway_id = params.get("colorway_id")
    if colorway_id is not None and colorway_id not in {c.id for c in palette.colorways}:
        raise FabricError(f"unknown colorway: {colorway_id!r}")

    material_map = params.get("material_map") or None

    strength = params.get("texture_strength")
    strength = DEFAULT_TEXTURE_STRENGTH if strength is None else float(strength)
    if strength < 0:
        raise FabricError("texture_strength must be >= 0")

    relief = params.get("relief_strength")
    relief = DEFAULT_RELIEF_STRENGTH if relief is None else float(relief)
    if relief < 0:
        raise FabricError("relief_strength must be >= 0")

    tile_mm = intent.canvas.tile_mm

    if method == "print":
        if not _is_print_weave(weave):
            raise FabricError("print method requires a twill weave")
        if material_map:
            raise FabricError("material_map is only valid for yarn_dyed")
        design = _render_design(intent, palette, colorway_id, dpi=dpi, tile_mm=tile_mm)
        return _encode(_apply_weave(design, weave, strength), dpi)

    # --- yarn_dyed ---
    if material_map:
        unknown_slots = sorted(set(material_map) - palette.slot_ids())
        if unknown_slots:
            raise FabricError(f"material_map references unknown slots: {unknown_slots}")
        bad_weaves = sorted(set(material_map.values()) - set(weaves))
        if bad_weaves:
            raise FabricError(f"material_map uses unknown weaves: {bad_weaves}")

    if segment_mod._motif_slots(intent):
        out = _render_yarn_dyed_motifs(
            intent,
            palette,
            colorway_id,
            weave=weave,
            material_map=material_map,
            strength=strength,
            relief=relief,
            dpi=dpi,
            tile_mm=tile_mm,
        )
        return _encode(out, dpi)

    design = _render_design(intent, palette, colorway_id, dpi=dpi, tile_mm=tile_mm)
    seg = None
    if material_map or relief > 0:
        seg = segment_mod.segment(intent, palette, dpi=dpi, tile_mm=tile_mm, split_motifs=False)
    out = materials.apply_materials(
        design, weave=weave, material_map=material_map, strength=strength, seg=seg
    )
    if relief > 0:
        assert seg is not None  # relief > 0이면 위에서 세그먼트를 만들었다
        out = materials.apply_relief(out, seg.slot_index, weave, relief, dpi=dpi)
    return _encode(out, dpi)


def _render_yarn_dyed_motifs(
    intent,
    palette,
    colorway_id,
    *,
    weave: str,
    material_map: dict[str, str] | None,
    strength: float,
    relief: float,
    dpi: int,
    tile_mm: float,
) -> Image.Image:
    n_px = max(1, mm_to_px(tile_mm, dpi)) ** 2
    if n_px > _MAX_INLAY_PIXELS:
        raise FabricError(f"motif inlay exceeds {_MAX_INLAY_PIXELS}px; lower dpi or tile_mm")

    seg = segment_mod.segment(intent, palette, dpi=dpi, tile_mm=tile_mm, split_motifs=True)  # R1
    base_intent = segment_mod._without_motif_layers(intent)
    if base_intent is None or not seg.motif_masks:
        # 모티프만 있는 intent(base 없음) — 실색 fallback(정상 경로 아님)
        design = _render_design(intent, palette, colorway_id, dpi=dpi, tile_mm=tile_mm)
        return _apply_weave(design, weave, strength)

    base_design = _render_design(base_intent, palette, colorway_id, dpi=dpi, tile_mm=tile_mm)  # R2
    base_seg = None
    if material_map:
        base_seg = segment_mod.segment(
            base_intent, palette, dpi=dpi, tile_mm=tile_mm, split_motifs=False
        )  # R3
    base = materials.apply_materials(
        base_design, weave=weave, material_map=material_map, strength=strength, seg=base_seg
    )

    # 실 색 소스 F — base 실색 위에 모티프 슬롯 평탄색을 마스크로 합성(마스크 disjoint → 순서 무관)
    yarn_src = base_design.copy()
    for slot, mask in seg.motif_masks.items():
        color = hex_to_rgb(palette.resolve_color(slot, colorway_id))
        yarn_src = Image.composite(Image.new("RGB", yarn_src.size, color), yarn_src, mask)
    yarn = _apply_weave(yarn_src, MOTIF_WEAVE, strength)

    # 슬롯별 run 스캔 후 union → 단일 합성(순서 무관, edge 음영은 정확히 1회)
    thread: Image.Image | None = None
    for mask in seg.motif_masks.values():
        strand = inlay.motif_thread_mask(mask, dpi=dpi)
        thread = strand if thread is None else ImageChops.lighter(thread, strand)
    assert thread is not None
    out = Image.composite(yarn, base, thread)
    if relief > 0:
        out = inlay.apply_thread_relief(out, thread, relief, dpi=dpi)
        out = materials.apply_relief(out, seg.slot_index, weave, relief, dpi=dpi)
    return out

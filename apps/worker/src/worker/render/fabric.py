"""fabric finalize — print(균일 weave) + yarn_dyed(영역별 weave·모티프 실 인레이·relief).

결정론: 동일 입력 → byte-identical PNG(Pillow·렌더러·에셋 핀 전제). compose+rasterize
호출 수를 최소로 유지하는 것이 계약이다
(worker-pipeline.md §2 "compose+rasterize 재실행 지점"):

    print                     : 1회 (실색 디자인)
    yarn_dyed, 모티프 없음     : 1회 + (material_map ∨ relief>0 시) 라벨 1회
    yarn_dyed, 모티프          : R1 full 실색 + R2 base 실색 + R3 모티프 마스크 = 3회
                +material_map/relief : + R4 base 라벨 = 4회

모티프 마스크는 기하학이다 — 팔레트를 검정, 모티프 심볼 paint를 흰색으로 치환한 마스크
문서를 렌더해 얻는다(render/motif_mask.py). 실 가닥 색 소스는 R1 자체를 사용하므로
팔레트 슬롯과 무관한 모티프 고유색이 그대로 보존된다.

원본 대비 의도적 차이 3건:
  ① 모티프 마스크는 마스크 문서 렌더에서 얻는다. z-order상 위 레이어에 가려진 부분에는
     가닥을 그리지 않지만, 색 대비에는 의존하지 않는다 — 모티프 색이 바탕색·팔레트색과
     같아도 실루엣이 사라지거나 쪼개지지 않는다.
  ② 모티프 가닥은 고정 twill-45를 쓰되 색 소스는 고유색을 담은 full 렌더다. 따라서 base
     material_map과 무관하고 생성 시 확정된 모티프 색을 보존한다.
  ③ weave 에셋 누락은 하드 에러다(원본은 평탄색 폴백). 에셋은 결정론 입력이므로 조용한
     폴백은 골든을 깨는 무결성 위험 — 명시적 실패가 옳다.

blocking(Pillow·subprocess) — async 핸들러에서는 run_in_threadpool로 호출.
"""

import io
from typing import Any

from PIL import Image

from worker.config import Settings
from worker.engine.composition import compose
from worker.engine.units import mm_to_px
from worker.engine.validate import validate_intent
from worker.motifs.registry import MotifCatalog, iter_motif_ids, resolve_motif
from worker.render import inlay, materials, motif_mask, raster
from worker.render import segment as segment_mod
from worker.render.inlay import MOTIF_WEAVE
from worker.render.weave import apply_weave, available_weaves, is_print_weave

DEFAULT_TEXTURE_STRENGTH = 2.4
DEFAULT_RELIEF_STRENGTH = 0.45
_MAX_INLAY_PIXELS = 20_000_000  # 모티프 인레이는 3× 슈퍼샘플·3×3 타일 — 픽셀 폭발 가드


class FabricError(ValueError):
    """잘못된 fabric 요청(unknown weave/colorway/slot 등). 영구 실패 — 라우트는 failed 기록."""


def _render_design(
    intent,
    palette,
    colorway_id,
    *,
    dpi: int,
    tile_mm: float,
    motifs: MotifCatalog | None = None,
) -> Image.Image:
    svg = compose(intent, palette, colorway_id, motifs)
    png, _ = raster.rasterize_svg(svg, fmt="png", width_mm=tile_mm, dpi=dpi, stamp_dpi=False)
    return Image.open(io.BytesIO(png)).convert("RGB")


def _encode(out: Image.Image, dpi: int) -> bytes:
    buf = io.BytesIO()
    out.save(buf, "PNG", dpi=(dpi, dpi))
    return buf.getvalue()


def render_fabric(
    params: dict[str, Any], settings: Settings, motifs: MotifCatalog | None = None
) -> bytes:
    intent_raw = params.get("intent")
    if not isinstance(intent_raw, dict):
        raise FabricError("finalize params require an `intent`")
    result = validate_intent(intent_raw)
    intent = result.intent
    palette = result.palette

    # 모티프는 렌더 깊숙이에서 resolve된다 — 미등록을 여기서 영구 실패로 확정해
    # 일시 실패로 오분류된 무의미한 재시도를 막는다.
    for motif_id in sorted(iter_motif_ids(intent_raw)):
        try:
            resolve_motif(motif_id, motifs)
        except ValueError as exc:
            raise FabricError(str(exc)) from None

    dpi = int(params.get("dpi") or settings.fabric_dpi)
    if not 0 < dpi <= settings.max_dpi:
        raise FabricError(f"dpi must be between 1 and {settings.max_dpi}")

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
        if not is_print_weave(weave):
            raise FabricError("print method requires a twill weave")
        if material_map:
            raise FabricError("material_map is only valid for yarn_dyed")
        design = _render_design(
            intent, palette, colorway_id, dpi=dpi, tile_mm=tile_mm, motifs=motifs
        )
        return _encode(apply_weave(design, weave, strength), dpi)

    # --- yarn_dyed ---
    if material_map:
        unknown_slots = sorted(set(material_map) - palette.slot_ids())
        if unknown_slots:
            raise FabricError(f"material_map references unknown slots: {unknown_slots}")
        bad_weaves = sorted(set(material_map.values()) - set(weaves))
        if bad_weaves:
            raise FabricError(f"material_map uses unknown weaves: {bad_weaves}")

    if any(layer.type == "motif" for layer in intent.layers):
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
            motifs=motifs,
        )
        return _encode(out, dpi)

    design = _render_design(intent, palette, colorway_id, dpi=dpi, tile_mm=tile_mm, motifs=motifs)
    seg = None
    if material_map or relief > 0:
        seg = segment_mod.segment(intent, palette, dpi=dpi, tile_mm=tile_mm)
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
    motifs: MotifCatalog | None = None,
) -> Image.Image:
    n_px = max(1, mm_to_px(tile_mm, dpi)) ** 2
    if n_px > _MAX_INLAY_PIXELS:
        raise FabricError(f"motif inlay exceeds {_MAX_INLAY_PIXELS}px; lower dpi or tile_mm")

    full_design = _render_design(
        intent, palette, colorway_id, dpi=dpi, tile_mm=tile_mm, motifs=motifs
    )  # R1
    base_intent = segment_mod.without_motif_layers(intent)
    if base_intent is None:
        # 모티프만 있는 intent(base 없음) — 실색 fallback(정상 경로 아님)
        return apply_weave(full_design, weave, strength)

    base_design = _render_design(
        base_intent, palette, colorway_id, dpi=dpi, tile_mm=tile_mm, motifs=motifs
    )  # R2
    coverage = motif_mask.motif_coverage_mask(
        intent, palette, dpi=dpi, tile_mm=tile_mm, motifs=motifs
    )  # R3
    base_seg = None
    if material_map or relief > 0:
        base_seg = segment_mod.segment(base_intent, palette, dpi=dpi, tile_mm=tile_mm)  # R4
    base = materials.apply_materials(
        base_design, weave=weave, material_map=material_map, strength=strength, seg=base_seg
    )

    yarn = apply_weave(full_design, MOTIF_WEAVE, strength)
    # 모티프가 전부 가려져 마스크가 비어도 relief 경로는 그대로 탄다 — 보이지 않는 레이어의
    # 유무가 슬롯 경계 emboss를 켜고 끄면 안 된다(빈 thread는 composite/emboss에 무해).
    thread = inlay.motif_thread_mask(coverage, dpi=dpi)
    out = Image.composite(yarn, base, thread)
    if relief > 0:
        out = inlay.apply_thread_relief(out, thread, relief, dpi=dpi)
        assert base_seg is not None
        out = materials.apply_relief(out, base_seg.slot_index, weave, relief, dpi=dpi)
    return out

"""fabric finalize — print(균일 weave 멀티플라이) 경로 (worker-pipeline.md §2).

yarn_dyed(영역별 weave·thread inlay·relief)는 파이프라인 재설계와 함께 후속 —
그전까지는 명시적으로 거부한다(가짜 성공 금지).
blocking(Pillow·subprocess) — async 핸들러에서는 run_in_threadpool로 호출.
"""

import io
from functools import lru_cache
from importlib.resources import files
from typing import Any

from PIL import Image, ImageChops

from worker.config import Settings
from worker.engine.composition import compose
from worker.engine.validate import validate_intent
from worker.render.raster import rasterize_svg

DEFAULT_TEXTURE_STRENGTH = 2.4


class FabricError(ValueError):
    pass


@lru_cache(maxsize=1)
def available_weaves() -> tuple[str, ...]:
    names = [
        item.name.removesuffix(".png")
        for item in files("worker.render.assets.fabric").iterdir()
        if item.name.endswith(".png")
    ]
    return tuple(sorted(names))


@lru_cache(maxsize=4)
def _weave_image(weave: str) -> Image.Image:
    data = (files("worker.render.assets.fabric") / f"{weave}.png").read_bytes()
    return Image.open(io.BytesIO(data)).convert("RGB")


def _is_print_weave(weave: str) -> bool:
    return weave.startswith("twill")


def _tile_to(texture: Image.Image, size: tuple[int, int]) -> Image.Image:
    """정수 개 복제 후 목표 크기로 리사이즈 — 부분 크롭 금지(seam 유지)."""
    tw, th = texture.size
    w, h = size
    nx = max(1, round(w / tw))
    ny = max(1, round(h / th))
    canvas = Image.new("RGB", (nx * tw, ny * th))
    for i in range(nx):
        for j in range(ny):
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


def render_fabric(params: dict[str, Any], settings: Settings) -> bytes:
    intent_raw = params.get("intent")
    if not isinstance(intent_raw, dict):
        raise FabricError("finalize params require an `intent`")
    result = validate_intent(intent_raw)

    dpi = int(params.get("dpi") or settings.fabric_dpi)
    if dpi > settings.max_dpi:
        raise FabricError(f"dpi must be <= {settings.max_dpi}")

    method = params.get("production_method") or result.intent.production.method
    if method not in {"print", "yarn_dyed"}:
        raise FabricError("production_method must be print or yarn_dyed")
    if method == "yarn_dyed":
        # 재설계 파이프라인(1회 세그멘테이션 기반) 구현 전 — 가짜 렌더로 성공 처리 금지
        raise FabricError("yarn_dyed finalize is not implemented yet")

    weave = params.get("weave") or "twill-45"
    if weave not in available_weaves():
        raise FabricError(f"unknown weave {weave!r}; available: {available_weaves()}")
    if not _is_print_weave(weave):
        raise FabricError("print method requires a twill weave")
    if params.get("material_map"):
        raise FabricError("material_map is only valid for yarn_dyed")

    strength = params.get("texture_strength")
    strength = DEFAULT_TEXTURE_STRENGTH if strength is None else float(strength)
    if strength < 0:
        raise FabricError("texture_strength must be >= 0")

    colorway_id = params.get("colorway_id")
    svg = compose(result.intent, result.palette, colorway_id)
    tile = result.intent.canvas.tile_mm
    png, _ = rasterize_svg(svg, fmt="png", width_mm=tile, dpi=dpi)
    design = Image.open(io.BytesIO(png)).convert("RGB")

    out = _apply_weave(design, weave, strength)
    buf = io.BytesIO()
    out.save(buf, "PNG", dpi=(dpi, dpi))
    return buf.getvalue()

"""weave 적용 — 균일/슬롯별 믹스 + 슬롯 경계 relief emboss (worker-pipeline.md §2).

weave 저수준 연산(_apply_weave/_tile_to/_weave_image)은 fabric.py에 모여 있고, 여기서는
호출 시점에 fabric 모듈 속성으로 접근한다(순환 import 회피 — 두 모듈 모두 함수 본문에서만
서로를 참조)."""

from PIL import Image, ImageChops, ImageOps

from worker.render import fabric
from worker.render.segment import Segmentation, mask_for

_RELIEF_MM = 0.17  # 경계 rim 폭 ≈ 이 값(물리, DPI 안정)
_RELIEF_RIM_MIN = 0.25  # weave 휘도가 rim 강도를 [이 값, 1]로 변조 — 균일 라인 방지


def apply_materials(
    design: Image.Image,
    *,
    weave: str,
    material_map: dict[str, str] | None,
    strength: float,
    seg: Segmentation | None = None,
) -> Image.Image:
    """base weave를 전면 적용하고, material_map이 있으면 슬롯 마스크별로 override weave를
    합성한다. 미지정 슬롯은 base weave 폴백. 영역이 disjoint라 합성 순서 무관(결정론)."""
    woven_cache: dict[str, Image.Image] = {}

    def woven(slot_weave: str) -> Image.Image:
        cached = woven_cache.get(slot_weave)
        if cached is None:
            cached = fabric._apply_weave(design, slot_weave, strength)
            woven_cache[slot_weave] = cached
        return cached

    out = woven(weave)
    if not material_map:
        return out
    assert seg is not None, "material_map requires segmentation"
    for slot, slot_weave in material_map.items():
        mask = mask_for(seg.slot_index, seg.index_for[slot])
        out = Image.composite(woven(slot_weave), out, mask)
    return out


def apply_relief(
    out: Image.Image, slot_index: Image.Image, weave: str, strength: float, *, dpi: int
) -> Image.Image:
    """슬롯 경계를 emboss해 yarn-dyed 영역이 융기한 실처럼 읽히게 한다.

    rim은 wrap-around ImageChops.offset(순환 시프트)에서 나오므로 seam-safe(blur 금지 —
    blur는 wrap하지 않아 seam을 연다). 광원은 좌상단 고정. rim은 (seamless) weave 휘도로
    변조돼 라인이 길이 방향으로 불균일해진다 — 실제 직조의 결을 재사용."""
    d = max(1, round(_RELIEF_MM * dpi / 25.4))
    idx = Image.frombytes("L", slot_index.size, slot_index.tobytes())

    binary_lut = [255 if i else 0 for i in range(256)]

    def rim(dx: int, dy: int) -> Image.Image:
        return ImageChops.difference(idx, ImageChops.offset(idx, dx, dy)).point(binary_lut)

    tex = ImageOps.autocontrast(
        fabric._tile_to(fabric._weave_image(weave), out.size).convert("L"), cutoff=1
    )
    mod_lut = [round(255 * (_RELIEF_RIM_MIN + (1 - _RELIEF_RIM_MIN) * i / 255)) for i in range(256)]
    mod = tex.point(mod_lut)
    hi = ImageChops.multiply(rim(d, d), mod)  # 좌상단 면 — 하이라이트
    lo = ImageChops.multiply(rim(-d, -d), mod)  # 우하단 면 — 그림자
    k = min(0.6, 0.26 * strength)
    lit = Image.blend(out, Image.new("RGB", out.size, (255, 255, 255)), k)
    dark = Image.blend(out, Image.new("RGB", out.size, (0, 0, 0)), k)
    out = Image.composite(lit, out, hi)
    return Image.composite(dark, out, lo)

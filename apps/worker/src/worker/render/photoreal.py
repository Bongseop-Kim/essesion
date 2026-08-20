"""photoreal finalize 캡슐 — 결정론 렌더를 참고로 gpt-image 편집 2회 (finalize-ai-fabric.md).

산출물 2장:
  넥타이 실사 — 고정 베이스 사진(assets/photo/tie-base.png)의 넥타이 영역만
                마스크 인페인팅으로 교체. 셔츠·매듭·조명은 사진에서 온다.
  원단 실사  — 결정론 타일 3×3을 편집 입력으로 준 접사.

두 편집 모두 참고 이미지로 [디자인 렌더, 직조 실물 사진]을 동봉한다 — "이렇게
짜인 것처럼"의 기준을 텍스트가 아니라 사진으로 준다. 결정론 계약은 참고 렌더까지
(prepare_photoreal_inputs는 byte-deterministic), AI 출력은 비결정론 — 고객 설득물이다.

마스크 규약(OpenAI images/edits): 첫 이미지에 적용, 소스와 동일 크기, 알파=0(투명)
영역이 편집 대상. tie-base-mask.png는 넥타이 위 알파 0.

blocking(Pillow·rsvg subprocess)은 prepare_photoreal_inputs에 모아 threadpool에서 호출.
"""

from __future__ import annotations

import asyncio
import io
from dataclasses import dataclass
from functools import lru_cache
from importlib.resources import files
from typing import Any

from PIL import Image

from worker.adapters import AdapterClientError
from worker.config import Settings
from worker.engine.validate import validate_intent
from worker.motifs.registry import MotifCatalog
from worker.render import raster
from worker.render.fabric import FabricError, render_fabric
from worker.render.weave import weave_image

# 편집 출력 크기 — 넥타이는 베이스 사진(1024×1536)과 동일해야 마스크가 성립한다.
TIE_EDIT_SIZE = "1024x1536"
FABRIC_EDIT_SIZE = "1024x1024"

# TieCanvas 기하 (packages/shared/src/components/tie-canvas.tsx와 동일 — 캔버스
# 미리보기와 참고 렌더의 패턴 스케일 감각을 일치시킨다).
_TIE_FRAME_W = 316
_TIE_SHADOW_W, _TIE_SHADOW_H = 397, 864
_TIE_ART_H = _TIE_FRAME_W * _TIE_SHADOW_H / _TIE_SHADOW_W  # ≈ 687.72
_MASK_TOP_FRAC = 0.084347
_MASK_HEIGHT_FRAC = 0.87244
_TILE_FRACTION_TIE = 0.16
_TILE_SCALE_BASE_MM = 48.0

_MOCKUP_SIDE = 1024  # 참고 렌더 캔버스(정사각) — store 캔버스와 같은 구도
_MOCKUP_PAD = 24
_FABRIC_INPUT_SIDE = 1024
_WEAVE_REF_SIDE = 512

# 직조 → 프롬프트 문구. KNOWN_WEAVES(api)·assets/fabric(에셋)과 3곳 결속 —
# 피커 옵션을 늘리면 여기도 함께 갱신해야 한다(테스트가 핀).
WEAVE_PROMPTS: dict[str, str] = {
    "twill-0": "straight twill weave with a fine horizontal rib",
    "twill-45": "diagonal twill weave with a crisp 45-degree rib",
    "herringbone": "herringbone weave with alternating V-shaped ribs",
    "jacquard": "jacquard weave with a raised, subtly glossy figured texture",
    "pindot": "pindot weave with a fine dotted surface texture",
    "check": "woven check texture with interlaced threads",
    "solid": "smooth plain weave with an even surface",
}

_METHOD_PROMPTS = {
    "print": "finely printed silk where the weave texture shows through the printed design",
    "yarn_dyed": "yarn-dyed woven silk where the pattern itself is woven from dyed threads",
}


@dataclass(frozen=True)
class PhotorealInputs:
    """편집 2회의 결정론 입력 묶음 — 같은 params는 같은 바이트."""

    tile_png: bytes  # 정본 타일 = render_fabric 출력 그대로 (디자이너 인수물)
    tie_reference_png: bytes
    fabric_input_png: bytes
    weave_reference_png: bytes
    tie_prompt: str
    fabric_prompt: str


def _photo_bytes(name: str) -> bytes:
    return (files("worker.render.assets.photo") / name).read_bytes()


@lru_cache(maxsize=1)
def base_photo_bytes() -> bytes:
    return _photo_bytes("tie-base.png")


@lru_cache(maxsize=1)
def base_mask_bytes() -> bytes:
    return _photo_bytes("tie-base-mask.png")


@lru_cache(maxsize=8)
def weave_reference_png(weave: str) -> bytes:
    """직조 실물 사진 참고본 — 중앙 정사각 크롭 + 512px 축소 (요청마다 리사이즈 방지)."""
    source = weave_image(weave)
    w, h = source.size
    side = min(w, h)
    box = ((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2)
    ref = source.crop(box).resize((_WEAVE_REF_SIDE, _WEAVE_REF_SIDE), Image.Resampling.LANCZOS)
    return _encode_png(ref)


def _encode_png(image: Image.Image) -> bytes:
    buf = io.BytesIO()
    image.save(buf, "PNG")
    return buf.getvalue()


@lru_cache(maxsize=1)
def _tie_silhouette(height: int) -> Image.Image:
    """tie.svg 실루엣을 목표 높이로 래스터 — 알파 채널이 곧 마스크."""
    svg = (files("worker.render.assets.photo") / "tie.svg").read_text()
    # rasterize_svg는 mm 단위 폭을 받는다 — 300dpi 기준으로 목표 픽셀 폭을 mm로 환산.
    aspect = 270.3 / 1283  # tie.svg viewBox
    width_px = max(1, round(height * aspect))
    width_mm = width_px * 25.4 / 300
    png, _ = raster.rasterize_svg(svg, fmt="png", width_mm=width_mm, dpi=300, stamp_dpi=False)
    sil = Image.open(io.BytesIO(png)).convert("RGBA")
    if sil.size != (width_px, height):
        sil = sil.resize((width_px, height), Image.Resampling.LANCZOS)
    return sil


@lru_cache(maxsize=1)
def _tie_shadow(size: tuple[int, int]) -> Image.Image:
    shadow = Image.open(io.BytesIO(_photo_bytes("tie-shadow.png"))).convert("RGBA")
    return shadow.resize(size, Image.Resampling.LANCZOS)


def _repeat_pattern(tile: Image.Image, size: tuple[int, int], tile_px: int) -> Image.Image:
    """타일을 tile_px 폭으로 축소해 중앙 정렬 반복 — CSS background(center, repeat) 동형."""
    tile_px = max(1, tile_px)
    scaled = tile.resize((tile_px, tile_px), Image.Resampling.LANCZOS)
    w, h = size
    canvas = Image.new("RGB", size)
    # 중앙 기준 오프셋: 패턴 셀 하나가 캔버스 중앙에 오도록
    ox = (w // 2 - tile_px // 2) % tile_px - tile_px
    oy = (h // 2 - tile_px // 2) % tile_px - tile_px
    for y in range(oy, h, tile_px):
        for x in range(ox, w, tile_px):
            canvas.paste(scaled, (x, y))
    return canvas


def tie_mockup_png(tile: Image.Image, *, tile_mm: float) -> bytes:
    """결정론 넥타이 참고 렌더 — TieCanvas와 같은 기하의 서버측 Pillow 합성."""
    canvas = Image.new("RGB", (_MOCKUP_SIDE, _MOCKUP_SIDE), (243, 244, 245))  # bg.neutral-weak

    art_h = _MOCKUP_SIDE - 2 * _MOCKUP_PAD
    art_w = max(1, round(art_h * _TIE_FRAME_W / _TIE_ART_H))
    art_x = (_MOCKUP_SIDE - art_w) // 2
    art_y = _MOCKUP_PAD

    mask_h = max(1, round(art_h * _MASK_HEIGHT_FRAC))
    mask_y = art_y + round(art_h * _MASK_TOP_FRAC)

    silhouette = _tie_silhouette(mask_h)
    sil_w, sil_h = silhouette.size
    sil_x = art_x + (art_w - sil_w) // 2

    tile_px = round(art_w * _TILE_FRACTION_TIE * (tile_mm / _TILE_SCALE_BASE_MM))
    pattern = _repeat_pattern(tile, (sil_w, sil_h), tile_px)
    canvas.paste(pattern, (sil_x, mask_y), silhouette.getchannel("A"))

    shadow = _tie_shadow((art_w, art_h))
    art_region = canvas.crop((art_x, art_y, art_x + art_w, art_y + art_h)).convert("RGBA")
    art_region.alpha_composite(shadow)
    canvas.paste(art_region.convert("RGB"), (art_x, art_y))
    return _encode_png(canvas)


def _fabric_input_png(tile: Image.Image) -> bytes:
    """결정론 타일 3×3 — 원단 접사 편집의 구조 입력."""
    w, h = tile.size
    grid = Image.new("RGB", (3 * w, 3 * h))
    for j in range(3):
        for i in range(3):
            grid.paste(tile, (i * w, j * h))
    out = grid.resize((_FABRIC_INPUT_SIDE, _FABRIC_INPUT_SIDE), Image.Resampling.LANCZOS)
    return _encode_png(out)


def weave_phrase(weave: str) -> str:
    phrase = WEAVE_PROMPTS.get(weave)
    if phrase is None:
        # 에셋·KNOWN_WEAVES에는 있는데 프롬프트 매핑이 빠진 상태 — 3곳 결속 위반.
        raise FabricError(f"no prompt mapping for weave {weave!r}")
    return phrase


def build_prompts(*, method: str, weave: str) -> tuple[str, str]:
    weave_text = weave_phrase(weave)
    method_text = _METHOD_PROMPTS[method]
    tie_prompt = (
        "Edit only the masked necktie region of the first image. "
        "Replace the tie's fabric with exactly the design shown in the second image — "
        "same colors, same pattern, same pattern scale and placement. "
        f"Render it as {method_text}, in a {weave_text} like the third image. "
        "Keep the shirt, collar, knot shape, folds and lighting of the photo unchanged. "
        "Do not alter the pattern geometry or colors. Photorealistic."
    )
    fabric_prompt = (
        "Create a photorealistic macro photograph of necktie fabric. "
        "Use exactly the design of the first image — same colors, same pattern, "
        "same scale, no redesign. "
        f"The fabric is {method_text}, in a {weave_text} like the second image. "
        "Soft studio light with a gentle sheen and visible thread texture. "
        "Do not alter the pattern geometry or colors."
    )
    return tie_prompt, fabric_prompt


def prepare_photoreal_inputs(
    params: dict[str, Any], settings: Settings, motifs: MotifCatalog | None = None
) -> PhotorealInputs:
    """결정론 구간 전체 — render_fabric이 입력 검증의 최종 권위(FabricError 재사용)."""
    tile_png = render_fabric(params, settings, motifs)
    result = validate_intent(params["intent"])  # render_fabric이 이미 통과시킨 intent

    method = params.get("production_method") or result.intent.production.method
    weave = params.get("weave") or "twill-45"
    tie_prompt, fabric_prompt = build_prompts(method=method, weave=weave)

    tile = Image.open(io.BytesIO(tile_png)).convert("RGB")
    return PhotorealInputs(
        tile_png=tile_png,
        tie_reference_png=tie_mockup_png(tile, tile_mm=result.intent.canvas.tile_mm),
        fabric_input_png=_fabric_input_png(tile),
        weave_reference_png=weave_reference_png(weave),
        tie_prompt=tie_prompt,
        fabric_prompt=fabric_prompt,
    )


def _validated_png(data: bytes, *, operation: str) -> bytes:
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.verify()
    except Exception as exc:
        raise AdapterClientError(
            "OpenAI edit returned an undecodable image",
            provider="openai_image",
            operation=operation,
            reason_code="invalid_response",
        ) from exc
    return data


async def render_photoreal(
    inputs: PhotorealInputs,
    gpt_image,  # noqa: ANN001 — GPTImageHTTPClient 프로토콜(edit), 테스트는 대역 주입
    *,
    quality: str,
) -> tuple[bytes, bytes]:
    """편집 2회 병렬 실행 → (넥타이 실사, 원단 실사). 1회라도 실패하면 전체 실패."""
    tie_png, fabric_png = await asyncio.gather(
        gpt_image.edit(
            inputs.tie_prompt,
            images=[base_photo_bytes(), inputs.tie_reference_png, inputs.weave_reference_png],
            mask=base_mask_bytes(),
            size=TIE_EDIT_SIZE,
            quality=quality,
            operation="finalize_tie",
        ),
        gpt_image.edit(
            inputs.fabric_prompt,
            images=[inputs.fabric_input_png, inputs.weave_reference_png],
            size=FABRIC_EDIT_SIZE,
            quality=quality,
            operation="finalize_fabric",
        ),
    )
    return (
        _validated_png(tie_png, operation="finalize_tie"),
        _validated_png(fabric_png, operation="finalize_fabric"),
    )

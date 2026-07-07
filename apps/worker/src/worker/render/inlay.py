"""모티프 실 인레이 — 대각 round-cap 가닥 + seam 위상 연속 (worker-pipeline.md §2).

모티프 영역을 `/` 방향 실 가닥으로 다시 그려 base fabric이 실 사이로 비치게 한다. 실
weave는 항상 twill-45 고정(MOTIF_WEAVE) — base weave/material_map과 무관(평탄색은 플라스틱,
슬롯별 weave는 패치워크처럼 읽힘). 가닥 위상은 마스크를 3×3 타일링 후 스캔하고 중앙을
crop해 tile 경계를 넘는 모티프에서도 연속한다.
"""

import math
from fractions import Fraction

from PIL import Image, ImageChops, ImageDraw

MOTIF_WEAVE = "twill-45"
THREAD_PERIOD_MM = 0.70
THREAD_FILL = 0.82
AA_SCALE = 3
MASK_THRESHOLD = 24  # 이 alpha/level 미만의 모티프 커버리지는 실로 치지 않음
THREAD_RELIEF_MM = 0.04  # 가닥 가장자리 음영 offset(물리, DPI 안정)
THREAD_SHADE_K = 0.23  # relief_strength 단위당 음영 강도


def thread_period_width(size: tuple[int, int], *, dpi: int) -> tuple[Fraction, int]:
    """가닥 간격(정확 유리수, px)과 폭(px).

    간격은 gcd(w, h)/n — 두 축을 정확히 정수 분할하므로 대각 라인군이 tile과 함께 두 방향
    모두에서 반복하고, tile 경계를 넘는 모티프의 가닥 위상이 보존된다. 유리수 step은 소수
    픽셀 크기에서도 mm 목표 근처에 머문다(정수 약수 탐색은 787/1181 같은 크기에서 tile 폭
    가닥 하나로 붕괴). 라인 위치는 floored 유리수라 seam에서 float 반올림 없이 shift 불변."""
    target = max(2.0, THREAD_PERIOD_MM * dpi / 25.4)
    g = math.gcd(*size)
    step = Fraction(g, max(1, round(g / target)))
    width = max(1, min(math.ceil(step) - 1, round(step * THREAD_FILL)))
    return step, width


def _tile_3x(mask: Image.Image) -> Image.Image:
    w, h = mask.size
    tiled = Image.new("L", (w * 3, h * 3))
    for ty in range(3):
        for tx in range(3):
            tiled.paste(mask, (tx * w, ty * h))
    return tiled


def _draw_round_thread(
    draw: ImageDraw.ImageDraw,
    p0: tuple[int, int],
    p1: tuple[int, int],
    *,
    width: int,
    scale: int,
) -> None:
    x0, y0 = p0
    x1, y1 = p1
    q0 = (x0 * scale + scale // 2, y0 * scale + scale // 2)
    q1 = (x1 * scale + scale // 2, y1 * scale + scale // 2)
    stroke = max(1, width * scale)
    radius = stroke / 2
    draw.line((q0, q1), fill=255, width=stroke)
    for x, y in (q0, q1):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=255)


def motif_thread_mask(motif_mask: Image.Image, *, dpi: int) -> Image.Image:
    """모티프 마스크를 겹친 `/` 캡슐 가닥으로 그린다.

    3×3 타일링 후 스캔하므로 tile 경계를 넘는 모티프 인스턴스가 seam 너머로 가닥 위상을
    유지한다. 각 대각 run은 그리기 전에 양끝을 inset해 실제 실처럼 둥근 end-cap을 남기고,
    yarn-dyed 생산이 보존 못 하는 미세 디테일을 자연히 떨군다."""
    w, h = motif_mask.size
    step, width = thread_period_width(motif_mask.size, dpi=dpi)
    threshold_lut = [255 if i >= MASK_THRESHOLD else 0 for i in range(256)]
    tiled = _tile_3x(motif_mask).point(threshold_lut)
    bw, bh = tiled.size
    scale = AA_SCALE
    drawn = Image.new("L", (bw * scale, bh * scale), 0)
    draw = ImageDraw.Draw(drawn)
    px = tiled.load()
    assert px is not None
    # 네이티브 대각 샘플은 sqrt(2)px 간격 — 반지름만큼 inset해 캡이 원 SVG 경계에서 평평하게
    # 잘리지 않고 모티프 안쪽에 앉게 한다.
    inset = max(1, math.ceil((width / 2) / math.sqrt(2)))
    min_run = inset * 2 + 1
    center_phase = width // 2

    def emit_run(coords: list[tuple[int, int]], start: int, end: int) -> None:
        if end - start + 1 < min_run:
            return
        _draw_round_thread(
            draw, coords[start + inset], coords[end - inset], width=width, scale=scale
        )

    # int(k*step)은 정확 유리수 floor라 라인군이 bw/bh(둘 다 step의 배수) shift에 불변 —
    # 중앙 crop이 seamless하게 tiling된다.
    for k in range(math.ceil((bw + bh - 1 - center_phase) / step)):
        c = center_phase + int(k * step)
        x0 = max(0, c - (bh - 1))
        x1 = min(bw - 1, c)
        if x1 < x0:
            continue
        coords = [(x, c - x) for x in range(x0, x1 + 1)]
        run_start: int | None = None
        for i, (x, y) in enumerate(coords):
            if px[x, y]:
                if run_start is None:
                    run_start = i
            elif run_start is not None:
                emit_run(coords, run_start, i - 1)
                run_start = None
        if run_start is not None:
            emit_run(coords, run_start, len(coords) - 1)

    strands = drawn.resize((bw, bh), Image.Resampling.LANCZOS)
    return strands.crop((w, h, w * 2, h * 2))


def apply_thread_relief(
    out: Image.Image, thread: Image.Image, strength: float, *, dpi: int
) -> Image.Image:
    """가닥 가장자리를 음영(좌상 밝게·우하 어둡게)해 캡슐이 둥글게 읽히게 한다. 슬롯 경계
    emboss와 같은 relief_strength 노브를 따른다 — 0이면 완전 평탄."""
    d = max(1, round(THREAD_RELIEF_MM * dpi / 25.4))
    hi = ImageChops.subtract(thread, ImageChops.offset(thread, d, d))
    lo = ImageChops.subtract(thread, ImageChops.offset(thread, -d, -d))
    k = min(0.5, THREAD_SHADE_K * strength)
    lit = Image.blend(out, Image.new("RGB", out.size, (255, 255, 255)), k)
    dark = Image.blend(out, Image.new("RGB", out.size, (0, 0, 0)), k)
    out = Image.composite(lit, out, hi)
    return Image.composite(dark, out, lo)

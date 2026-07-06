"""SVG 래스터화 — 시스템 렌더러 서브프로세스 (worker-pipeline.md §1).

CPU 바운드 + blocking subprocess — async 핸들러에서는 반드시 run_in_threadpool로
호출할 것. 항상 Pillow로 재인코딩해 물리 DPI를 스탬프한다(인쇄 실측 크기 정보).
resvg-py 인프로세스 전환은 동등성 판정 후(plan 6번) — 그전까지 librsvg 기준선.
"""

import io
import subprocess
from shutil import which

from PIL import Image

from worker.engine.units import mm_to_px

MAX_DIMENSION_PX = 20_000
_MEDIA = {"png": "image/png", "tiff": "image/tiff"}


class RasterError(RuntimeError):
    pass


def rasterize_svg(
    svg: str,
    *,
    fmt: str = "png",
    width_mm: float,
    height_mm: float | None = None,
    dpi: int = 300,
) -> tuple[bytes, str]:
    """(바이너리, media_type) 반환. blocking — threadpool에서 호출."""
    media = _MEDIA.get(fmt)
    if media is None:
        raise RasterError(f"unsupported format: {fmt}")
    height_mm = height_mm if height_mm is not None else width_mm
    width_px = max(1, mm_to_px(width_mm, dpi))
    height_px = max(1, mm_to_px(height_mm, dpi))
    if max(width_px, height_px) > MAX_DIMENSION_PX:
        raise RasterError(f"raster size exceeds {MAX_DIMENSION_PX}px")

    if binary := which("rsvg-convert"):
        cmd = [binary, "-w", str(width_px), "-h", str(height_px), "-f", "png", "-"]
    elif binary := which("resvg"):
        cmd = [binary, "-w", str(width_px), "-h", str(height_px), "-", "-c"]
    else:
        raise RasterError("rsvg-convert/resvg not found")

    proc = subprocess.run(cmd, input=svg.encode("utf-8"), capture_output=True, check=False)
    if proc.returncode or not proc.stdout:
        raise RasterError(proc.stderr.decode(errors="replace") or "rasterizer returned no output")

    # 물리 DPI 메타 스탬프 — 렌더러 출력에는 없다
    image = Image.open(io.BytesIO(proc.stdout))
    out = io.BytesIO()
    if fmt == "png":
        image.save(out, format="PNG", dpi=(dpi, dpi))
    else:
        image.save(out, format="TIFF", dpi=(dpi, dpi), compression="tiff_lzw")
    return out.getvalue(), media

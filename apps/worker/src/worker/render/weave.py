"""weave 에셋 접근 + 저수준 텍스처 연산 — fabric·materials·inlay 공용 (worker-pipeline.md §2).

에셋(assets/fabric/*.png)은 결정론 입력이다: 누락은 하드 에러(조용한 폴백 금지).
api의 KNOWN_WEAVES 사전검증 상수는 이 에셋 stem 목록과 일치해야 한다
(apps/api tests/test_design.py::test_known_weaves_match_worker_assets가 핀).
"""

import io
from functools import lru_cache
from importlib.resources import files

from PIL import Image, ImageChops


@lru_cache(maxsize=1)
def available_weaves() -> tuple[str, ...]:
    names = [
        item.name.removesuffix(".png")
        for item in files("worker.render.assets.fabric").iterdir()
        if item.name.endswith(".png")
    ]
    return tuple(sorted(names))


def weave_bytes(weave: str) -> bytes:
    """에셋 접근 단일 접합부 — 테스트는 이 함수를 monkeypatch(+weave_image.cache_clear)."""
    return (files("worker.render.assets.fabric") / f"{weave}.png").read_bytes()


@lru_cache(maxsize=8)
def weave_image(weave: str) -> Image.Image:
    return Image.open(io.BytesIO(weave_bytes(weave))).convert("RGB")


def is_print_weave(weave: str) -> bool:
    return weave.startswith("twill")


def tile_to(texture: Image.Image, size: tuple[int, int]) -> Image.Image:
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


def apply_weave(design: Image.Image, weave: str, strength: float) -> Image.Image:
    tex = tile_to(weave_image(weave), design.size)
    if strength != 1.0:
        lut = [max(0, min(255, round(255 - (255 - v) * strength))) for v in range(256)]
        tex = tex.point(lut * 3)
    return ImageChops.multiply(design, tex)

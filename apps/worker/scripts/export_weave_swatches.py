"""원단 짜임 텍스처(worker 에셋) → store 실사화 모달용 스와치 PNG.

실사화 모달의 짜임 선택은 텍스트 설명만으로는 무엇을 고르는지 알기 어렵다. 워커가
실제 렌더에 쓰는 텍스처(`worker/render/assets/fabric/*.png`)를 그대로 보여주는 것이
가장 정직하지만 원본은 2~7MB이고, 흰 원단이라 그대로 축소하면 결이 사라진다.

그래서 두 가지를 한다:
  - **중앙 1/4 크롭** — 결이 보이도록 4배 확대 효과.
  - **콘트라스트 스트레치** — 원본은 평균 235·표준편차 5~14의 거의 흰 이미지다.
    표준편차를 목표치로 끌어올려 흰 원단 느낌은 유지하면서 결을 드러낸다.

에셋이 바뀌면 다시 실행한다(멱등, 외부 호출 없음):

    uv run python apps/worker/scripts/export_weave_swatches.py
"""

from pathlib import Path

from PIL import Image, ImageStat

REPO = Path(__file__).resolve().parents[3]
SRC = REPO / "apps/worker/src/worker/render/assets/fabric"
OUT = REPO / "apps/store/public/images/weaves"

SIDE = 224
CROP_DIVISOR = 4
TARGET_STDDEV = 22.0
# solid(표준편차 4.7)까지 목표치로 끌면 균일해야 할 평직에 없는 음영이 생긴다.
MAX_GAIN = 3.5


def stretch(image: Image.Image) -> Image.Image:
    """흰쪽을 고정한 채 어두운쪽만 늘린다 — 원단이 회색으로 변하지 않는다."""
    stddev = ImageStat.Stat(image).stddev[0]
    gain = min(MAX_GAIN, TARGET_STDDEV / stddev) if stddev > 0 else 1.0
    return image.point(lambda v: max(0, min(255, round(255 - (255 - v) * gain))))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for src in sorted(SRC.glob("*.png")):
        image = Image.open(src).convert("L")
        side = min(image.size) // CROP_DIVISOR
        left, top = (image.width - side) // 2, (image.height - side) // 2
        crop = image.crop((left, top, left + side, top + side))
        crop = stretch(crop).resize((SIDE, SIDE), Image.Resampling.LANCZOS)
        crop.save(OUT / src.name, optimize=True)
        print(f"  {src.stem} → {OUT.relative_to(REPO) / src.name}")


if __name__ == "__main__":
    main()

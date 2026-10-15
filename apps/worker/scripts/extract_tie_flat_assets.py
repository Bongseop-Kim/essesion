"""평면 넥타이 사진에서 템플릿 목록용 미리보기 에셋을 추출한다.

매듭 없이 몸통 위를 수평으로 자른 정면 컷 — 템플릿 목록(/design)의 전체 샷·확대 샷이 쓴다.
매듭 있는 실사 컷(extract_tie_assets.py)은 상세에서 그대로 쓴다.

산출물(같은 크기, 아트 박스 = 마스크 박스):
  tie-flat-mask.png    실루엣(알파)
  tie-flat-shadow.png  명암 레이어 — 넥타이 위는 사진 명암(무늬를 지운 조명), 바깥은 바닥 그림자

    uv run python apps/worker/scripts/extract_tie_flat_assets.py <원본.png> <out_dir>

원본(236×310 화면 캡처, 흰 배경에 남색 마름모 무늬 넥타이)은 레포에 두지 않는다 — 쓰는 곳은
이 스크립트뿐이다. 다른 사진으로 다시 뽑으면 OUTLINE·BOX(사진 좌표)를 새로 재야 한다.

store public/images/에 tie-flat-mask.png와 tie-flat-shadow.webp를 복사한다.
기하(TieCanvas의 flat 상수)는 아트 박스 비율이라 OUT 크기·여백이 바뀌면 함께 손볼 것.
"""

import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

src, out_dir = sys.argv[1], sys.argv[2]

photo = Image.open(src).convert("L")  # 236×310 스크린샷 — 아래 "06" 라벨은 아트 박스 밖
L = np.asarray(photo, dtype=np.float32)
BG = 254.0

# 실측 외곽(사진 좌표): 윗변 → 어깨 → 끝. 좌우 기울기는 사진 그대로(아래로 갈수록 살짝 벌어진다).
OUTLINE = [(25, 15), (213, 15), (223, 182), (114, 288), (12, 182)]
# 아트 박스: 넥타이 bbox + 바닥 그림자 여백
BOX = (2, 5, 234, 298)
S = 4  # 업스케일 — 명암은 저주파라 사진 해상도로 충분, 외곽은 다각형으로 새로 그려 선명하게

bw, bh = BOX[2] - BOX[0], BOX[3] - BOX[1]
OUT_W, OUT_H = bw * S, bh * S


def up(img: Image.Image) -> Image.Image:
    return img.crop(BOX).resize((OUT_W, OUT_H), Image.Resampling.BICUBIC)


mask = Image.new("L", (OUT_W, OUT_H), 0)
ImageDraw.Draw(mask).polygon([((x - BOX[0]) * S, (y - BOX[1]) * S) for x, y in OUTLINE], fill=255)
# 가장자리 1px 블러 대신 4배 그린 뒤 살짝 깎아 사진 테두리(밝은 반사)가 무늬 위로 비치지 않게
mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
m = np.asarray(mask, np.float32) / 255

# --- 넥타이 명암: 밝은 무늬(마름모·로고)를 열림 연산으로 지우고 남은 남색 바탕의 조명만 쓴다.
src_mask = Image.new("L", photo.size, 0)
ImageDraw.Draw(src_mask).polygon(OUTLINE, fill=255)
inner = src_mask.filter(ImageFilter.MinFilter(5))
base = photo.filter(ImageFilter.MinFilter(7)).filter(ImageFilter.MaxFilter(3))
# 남색 바탕은 밝기 20~40이라 8비트 양자화·실 결이 그대로 얼룩이 된다 — 평평한 천의 조명은
# 완만하니 무늬를 지운 밝기에 2차 곡면을 맞춰 그것만 쓴다.
b = np.asarray(base, np.float32)
yy, xx = np.nonzero(np.asarray(inner, bool))
v = b[yy, xx]
A = np.stack([np.ones_like(xx), xx, yy, xx * xx, xx * yy, yy * yy], 1).astype(np.float64)
coef = np.linalg.lstsq(A, v, rcond=None)[0]
fill = float(np.median(v))
gy, gx = np.mgrid[0 : photo.size[1], 0 : photo.size[0]].astype(np.float64)
surf = sum(c * t for c, t in zip(coef, (1, gx, gy, gx * gx, gx * gy, gy * gy), strict=True))
# 2차 곡면은 끝 쪽에서 과하게 꺾인다 — 사진에서 보이는 정도(±10%)로 제한.
# float로 키워 계단을 막는다.
ratio = np.asarray(
    up(Image.fromarray((surf / fill).clip(0.9, 1.1).astype(np.float32), "F")), np.float32
)


def blur(a: np.ndarray, sigma: float) -> np.ndarray:
    """float 가우시안 블러(PIL GaussianBlur는 F 모드를 안 받는다) — 가장자리는 끝값 연장."""
    r = int(3 * sigma) + 1
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    a = np.pad(a, r, mode="edge")
    a = np.apply_along_axis(np.convolve, 0, a, k, mode="valid")
    return np.apply_along_axis(np.convolve, 1, a, k, mode="valid")


# 천 가장자리가 접혀 살짝 어둡다 — 잘린 윗변은 접힌 데가 아니라 빼고(윗변 위에 사각형을
# 덧대 그 쪽엔 '바깥'이 없게). 꼭짓점을 위로 옮기면 옆선 기울기가 바뀌어 위쪽 옆 테두리가 빠진다.
rim_mask = Image.new("L", (OUT_W, OUT_H), 0)
_rd = ImageDraw.Draw(rim_mask)
_rd.polygon([((x - BOX[0]) * S, (y - BOX[1]) * S) for x, y in OUTLINE], fill=255)
(_tlx, _ty), (_trx, _) = OUTLINE[0], OUTLINE[1]
_rd.rectangle(((_tlx - BOX[0]) * S, 0, (_trx - BOX[0]) * S, (_ty - BOX[1]) * S), fill=255)
rim = 1 - np.asarray(rim_mask.filter(ImageFilter.GaussianBlur(2 * S)), np.float32) / 255
# 실크 능직 결 — extract_tie_assets.py와 같은 결(41°, 진폭을 천천히 흔드는 노이즈)을 블레이드 폭
# 대비 같은 밀도로(실사 컷: 블레이드 540px에 주기 7.5px → 72주기).
_period = (OUTLINE[2][0] - OUTLINE[4][0]) * S / 72
_th = np.radians(41)
_gy, _gx = np.mgrid[0:OUT_H, 0:OUT_W].astype(np.float32)
_rng = np.random.default_rng(7)
_mod = (
    np.asarray(
        Image.fromarray(
            (_rng.random((OUT_H // 128 + 1, OUT_W // 128 + 1)) * 255).astype(np.uint8)
        ).resize((OUT_W, OUT_H), Image.Resampling.BICUBIC),
        np.float32,
    )
    / 255
)
twill = (
    0.035
    * (0.6 + 0.8 * _mod)
    * np.sin(2 * np.pi / _period * (np.cos(_th) * _gx + np.sin(_th) * _gy))
)
ratio = np.minimum(ratio, 1) - rim * 0.45 + np.maximum(ratio - 1, 0) + twill
dark = (1 - ratio).clip(0, None)
light = (ratio - 1).clip(0, None)
tie_g = np.where(ratio < 1, 0, 255).astype(np.float32)
tie_a = np.where(ratio < 1, (dark * 1.5).clip(0, 0.82), (light * 0.7).clip(0, 0.3)) * m

# --- 바닥 그림자: 사진 배경이 흰색보다 어두운 만큼. 빛이 왼쪽 위라 오른쪽·아래로 진다.
shade = ((BG - L) / BG).clip(0, 1)
# 넥타이 외곽 2px은 넥타이 안티에일리어싱이 섞여 검다 — 바로 바깥 값을 안쪽으로 한 칸씩 밀어 메운다.
# 그대로 두면 깎아 그린 마스크 밖에 검은 윤곽선이, 블러로 메우면 먼 배경이 섞여 흰 틈이 남는다.
ring = np.asarray(src_mask.filter(ImageFilter.MaxFilter(5)), bool)
for _ in range(3):
    known = np.where(ring, -1, shade).astype(np.float32)
    grow = np.max(
        [np.roll(np.roll(known, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1)], 0
    )
    newly = ring & (grow >= 0)
    shade = np.where(newly, grow, shade)
    ring &= ~newly
# 넥타이 둘레 약 20px까지만 쓰고 바깥으로 부드럽게 사라진다(멀리는 화면 캡처 배경의 옅은 얼룩).
near = blur(np.asarray(src_mask.filter(ImageFilter.MaxFilter(31)), np.float32) / 255, 5)
# 왼쪽 아래 "06" 라벨 제외
yy_, xx_ = np.mgrid[0 : photo.size[1], 0 : photo.size[0]]
label = np.clip((yy_ - 284) / 3, 0, 1) * np.clip((70 - xx_) / 10, 0, 1)
# 비스듬한 옆선을 따라 사진 픽셀 계단이 남는다 — 키우기 전에 살짝 흐린다.
shade = blur(shade * near * (1 - label), 0.8)
shadow_a = np.asarray(up(Image.fromarray(shade.astype(np.float32), "F")), np.float32).clip(0, 1)
shadow_a *= 1 - m

g = tie_g * tie_a / np.maximum(tie_a + shadow_a * (1 - tie_a), 1e-6)
a = tie_a + shadow_a * (1 - tie_a)
# 8비트 알파 계단을 흩는 디더(±0.5 단계)
a = a + (np.random.default_rng(7).random(a.shape) - 0.5) / 255 * (a > 0)
layer = Image.merge(
    "LA",
    (
        Image.fromarray(g.clip(0, 255).astype(np.uint8)),
        Image.fromarray((a * 255).clip(0, 255).astype(np.uint8)),
    ),
)
layer.save(f"{out_dir}/tie-flat-shadow.png", optimize=True)
# 명암 알파가 0~0.15로 좁아 손실 알파(alpha_quality<100)면 동심원 계단이 진다
# — 알파는 무손실.
layer.convert("RGBA").save(
    f"{out_dir}/tie-flat-shadow.webp", quality=75, alpha_quality=100, method=6
)
Image.merge("LA", (Image.new("L", mask.size, 0), mask)).save(
    f"{out_dir}/tie-flat-mask.png", optimize=True
)

xs = [x for x, _ in OUTLINE]
ys = [y for _, y in OUTLINE]
print(f"OUT {OUT_W}x{OUT_H}")
print(f"blade width frac {(max(xs) - min(xs)) / bw:.4f}")
print(
    f"top y frac {(min(ys) - BOX[1]) / bh:.4f}",
    f"shoulder {(182 - BOX[1]) / bh:.4f}",
    f"tip {(max(ys) - BOX[1]) / bh:.4f}",
)

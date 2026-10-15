"""실사 베이스 사진(tie-base.png)에서 넥타이 미리보기 에셋을 추출한다.

산출물(같은 크기 OUT_W×OUT_H, 아트 박스 = 마스크 박스):
  tie-mask.png       넥타이 실루엣(알파)
  tie-knot-mask.png  매듭만(알파) — 무늬 좌우 반전 레이어용
  tie-shadow.png     명암 레이어 — 넥타이 위는 사진 명암(어둡게/밝게),
                     바깥은 셔츠·깃 사진이 매듭 둘레 타원 밖으로 사라진다

사진은 매듭 아래 몸통 일부까지만 있다 —
몸통 나머지와 끝은 사진 몸통의 가로 명암 프로필로 이어 그린다.
매듭:몸통 = 1:11.

    uv run python apps/worker/scripts/extract_tie_assets.py \
        apps/worker/src/worker/render/assets/photo/tie-base.png <out_dir>

PNG 셋은 worker assets/photo/에,
tie-mask·tie-knot-mask PNG와 tie-shadow.webp는 store·admin public/images/에 복사한다.
기하(TIE_EMBLEM·TIE_FOCUS·photoreal 상수)는 아트 박스 비율이라 OUT 크기가 바뀌면 함께 손볼 것.
"""

import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

src, out_dir = sys.argv[1], sys.argv[2]

photo = Image.open(src).convert("L")
PW, PH = photo.size  # 1024×1536
L = np.asarray(photo, dtype=np.float32)

# --- 매듭: 사진 위 수작업 외곽선(깃 안쪽 선 → 매듭 옆선 → 목)
# 옆선은 실크 결(고주파)이 있는 범위로 실측했다 — 밝기로는 깃 밑 셔츠 그늘과 구분되지 않는다.
KNOT = [
    (452, 70),
    (520, 66),
    (595, 66),
    (650, 94),
    (702, 128),  # 윗변·오른쪽 깃 안쪽 선
    (700, 152),
    (688, 180),
    (668, 210),
    (650, 240),
    (634, 270),
    (620, 300),
    (608, 330),
    (598, 354),  # 오른쪽 옆선
    (444, 354),  # 목
    (440, 330),
    (429, 300),
    (418, 270),
    (402, 240),
    (384, 210),
    (362, 180),
    (346, 150),
    (344, 135),  # 왼쪽 옆선
    (372, 112),
    (410, 88),  # 왼쪽 깃 안쪽 선
]
KT, KB = 60, 354
KH = KB - KT
BTIP = KB + 11 * KH
TIP_H = 250
WMAX = 540  # 몸통 최대 폭

# --- 몸통(사진 구간): 행마다 가운데에서 밝기 175 미만으로 이어진 구간
med = np.asarray(photo.filter(ImageFilter.MedianFilter(7)), dtype=np.float32)
rows = range(KB - 6, PH)
left, right = {}, {}
c = 522
for y in rows:
    r = med[y]
    th = 150  # 오른쪽은 셔츠 그늘(150~170)이 넥타이에 붙어 있어 더 엄격하게
    lo = c
    while lo > 0 and r[lo - 1] < 175:
        lo -= 1
    hi = c
    while hi < PW - 1 and r[hi + 1] < th:
        hi += 1
    left[y], right[y] = lo, hi
    c = (lo + hi) // 2
ys = np.array(list(rows))
lv = np.convolve(np.array([left[y] for y in ys], float), np.ones(15) / 15, mode="same")
rv = np.convolve(np.array([right[y] for y in ys], float), np.ones(15) / 15, mode="same")
lv[:8], rv[:8] = lv[8], rv[8]
lv[-8:], rv[-8:] = lv[-9], rv[-9]
# 매듭 바로 밑은 셔츠 그늘이 붙어 넓게 잡힌다 — 매듭 아래 모서리에서 천천히 벌어지게 제한
near = ys < KB + 60
lv[near] = np.maximum(lv[near], 444 - (ys[near] - KB).clip(0) * 0.25)
rv[near] = np.minimum(rv[near], 598 + (ys[near] - KB).clip(0) * 0.35)
# 사진 아래쪽 옆선은 2차 곡선으로 맞춘다 — 사진 그대로면 군데군데 불룩해 연장 구간과 꺾인다
fit = ys > 700
lq = np.polyfit(ys[fit], lv[fit], 2)
rq = np.polyfit(ys[fit], rv[fit], 2)
w = np.clip((ys - 800) / 200, 0, 1)
lv = lv * (1 - w) + np.polyval(lq, ys) * w
rv = rv * (1 - w) + np.polyval(rq, ys) * w
la, ra = np.polyval(np.polyder(lq), PH - 1), np.polyval(np.polyder(rq), PH - 1)

H = BTIP + 40
edges = np.zeros((H, 2), np.float32)
for i, y in enumerate(ys):
    edges[y] = (lv[i], rv[i])
l0, r0 = edges[PH - 1]
for y in range(PH, H):
    lo, hi = l0 + la * (y - PH + 1), r0 + ra * (y - PH + 1)
    mid, half = (lo + hi) / 2, (hi - lo) / 2
    knee = WMAX / 2 - 24  # 최대 폭에 꺾이지 않고 부드럽게 붙는다
    if half > knee:
        half = WMAX / 2 - 24 * np.exp(-(half - knee) / 24)
    if y > BTIP - TIP_H:
        half_shoulder = (
            edges[BTIP - TIP_H][1] - (edges[BTIP - TIP_H][0] + edges[BTIP - TIP_H][1]) / 2
        )
        half = max(0.0, half_shoulder * (BTIP - y) / TIP_H)
    edges[y] = (mid - half, mid + half)

# 중심선 수직 고정 — 사진은 오른쪽 선이 더 빨리 벌어져, 그 기울기로 이어 그리면 끝으로 갈수록
# 오른쪽으로 휜다(끝에서 +45px). 폭은 그대로 두고 중심만 사진 몸통 중간(y 600~1050)의 평균에 맞춘다.
C = float(np.mean([(edges[y][0] + edges[y][1]) / 2 for y in range(600, 1050)]))
for y in range(900, H):
    w = min(1.0, (y - 900) / 300)
    mid = (edges[y][0] + edges[y][1]) / 2
    half = (edges[y][1] - edges[y][0]) / 2
    mid = mid * (1 - w) + C * w
    edges[y] = (mid - half, mid + half)

# --- 마스크(사진 좌표, 4배 슈퍼샘플 대신 가장자리 1px 블러)
mask = Image.new("L", (PW, H), 0)
d = ImageDraw.Draw(mask)
d.polygon(KNOT, fill=255)
blade_poly = [(edges[y][0], y) for y in range(KB - 6, BTIP)] + [
    (edges[y][1], y) for y in range(BTIP - 1, KB - 7, -1)
]
d.polygon(blade_poly, fill=255)
knot_mask = Image.new("L", (PW, H), 0)
ImageDraw.Draw(knot_mask).polygon(KNOT, fill=255)
# 가장자리 2px을 깎아 깃·셔츠의 밝은 테두리가 무늬 위로 비치지 않게
mask = mask.filter(ImageFilter.MinFilter(5))
knot_mask = knot_mask.filter(ImageFilter.MinFilter(5))

# --- 넥타이 명암: 매듭은 사진 그대로(결이 매듭을 따라 휜다), 몸통은 결을 지운 사진 조명 + 합성 결
Lb = np.asarray(photo.filter(ImageFilter.GaussianBlur(2.4)), dtype=np.float32)
Ls = np.asarray(photo.filter(ImageFilter.GaussianBlur(7)), dtype=np.float32)

# 실크 능직 결: 사진 몸통의 결(FFT 실측 주기 7.5px·파수 방향 41°, 진폭 σ≈2.9)을 사인파로
# 합성한다 — 사진 결은 축소하면 가로 무늬로 깨지고, 조각 반복은 이음매가 보인다.
_k = 2 * np.pi / 7.5
_th = np.radians(41)
_rng = np.random.default_rng(7)
_mod = (
    np.asarray(
        Image.fromarray((_rng.random((H // 32 + 1, PW // 32 + 1)) * 255).astype(np.uint8)).resize(
            (PW, H), Image.Resampling.BICUBIC
        ),
        np.float32,
    )
    / 255
)


def twill(y: int, xs: np.ndarray) -> np.ndarray:
    return 4.1 * (0.6 + 0.8 * _mod[y, xs]) * np.sin(_k * (np.cos(_th) * xs + np.sin(_th) * y))


# 몸통 조명: 사진 몸통 전 구간의 가로 명암 단면(폭 정규화) 평균 하나를 위아래로 똑같이 쓴다.
# 사진 조명 그대로면 위쪽 하이라이트가 사진이 끝나는 중간에서 끊긴다.
BINS = 96
prof = np.zeros(BINS)
cnt = np.zeros(BINS)
for y in range(KB + 100, PH - 4):
    lo, hi = edges[y]
    xs = np.arange(int(lo) + 1, int(hi))
    u = ((xs - lo) / (hi - lo) * BINS).astype(int).clip(0, BINS - 1)
    np.add.at(prof, u, Ls[y, xs])
    np.add.at(cnt, u, 1)
prof /= np.maximum(cnt, 1)
# 가장자리 칸은 셔츠가 섞여 밝다 — 안쪽 값으로 채우고, 칸 단위 계단은 펴 준다
prof[:8], prof[-8:] = prof[8], prof[-9]
prof = np.convolve(np.pad(prof, 10, mode="edge"), np.ones(21) / 21, mode="valid")

tie_l = np.zeros((H, PW), np.float32)
# 마스크 가장자리에 걸린 셔츠(밝음)가 무늬 위 하이라이트로 번지지 않게 넥타이 밝기 상한
tie_l[:PH] = np.minimum(Lb, 160)
SHOULDER = BTIP - TIP_H
for y in range(KB - 30, H):
    lo, hi = edges[y]
    if hi - lo < 1:
        continue
    xs = np.arange(max(0, int(lo) - 1), min(PW, int(hi) + 2))
    if y < SHOULDER:
        u = ((xs - lo) / (hi - lo) * BINS).astype(int).clip(0, BINS - 1)
        row = prof[u] + twill(y, xs)
        if y < KB + 200:  # 매듭 밑(사진: 보조개·결) → 몸통(공통 단면·합성 결)
            t = np.clip((y - (KB - 30)) / 230, 0, 1) ** 1.5
            row = Lb[y, xs] * (1 - t) + row * t
    else:
        # 끝 삼각형은 어깨 단면을 그대로 잘라낸 모양 — 폭으로 다시 늘이면 명암이 쏠린다
        slo, shi = edges[min(y, SHOULDER)]
        u = ((xs - slo) / (shi - slo) * BINS).astype(int).clip(0, BINS - 1)
        row = prof[u] + twill(y, xs)
    tie_l[y, xs] = row
ref = float(np.percentile(tie_l[KT:1500][np.asarray(mask, bool)[KT:1500]], 80))
ratio = tie_l / ref
# 천 가장자리가 말려 들어가며 살짝 어두워진다(사진 가장자리의 셔츠 반사도 덮는다)
rim = 1 - np.asarray(mask.filter(ImageFilter.GaussianBlur(5)), np.float32) / 255
# 테두리 0.55·상한 0.82는 밝은 넥타이에서 연필 윤곽선·매듭 아래 검은 줄이 된다 — 0.3·0.65.
ratio = np.minimum(ratio, 1) - rim * 0.3 + np.maximum(ratio - 1, 0) * (1 - rim * 2).clip(0, 1)
# 끝 삼각형 가장자리는 살짝 어둡게(접힌 천 두께)
tie_rgba = np.zeros((H, PW, 2), np.float32)  # (회색값, 알파)
dark = (1 - ratio).clip(0, None)
light = (ratio - 1).clip(0, None)
tie_rgba[..., 0] = np.where(ratio < 1, 0, 255)
tie_rgba[..., 1] = np.where(ratio < 1, (dark * 1.5).clip(0, 0.65), (light * 0.7).clip(0, 0.3))
m = np.asarray(mask.filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255
tie_rgba[..., 1] *= m

# --- 셔츠·깃: 사진 그대로, 위에서 아래로 사라지고 사진 좌우 끝에서도 사라진다
shirt = np.zeros((H, PW, 2), np.float32)
shirt[:PH, :, 0] = L
yy = np.arange(H)[:, None]
xx = np.arange(PW)[None, :]
# 매듭을 중심으로 한 타원 안에서만 보이고 바깥으로 부드럽게 사라진다
ell = ((xx - 522) / 500) ** 2 + ((yy - 120) / 560) ** 2
fade = np.clip((1 - ell) * 2.2, 0, 1) ** 1.5 * np.clip(yy / 70, 0, 1) ** 0.7
shirt[..., 1] = fade * (1 - m)
shirt[PH:, :, 1] = 0

# --- 셔츠가 사라진 아래쪽: 바닥에 지는 넥타이 그림자
sh = mask.transform(mask.size, Image.Transform.AFFINE, (1, 0, -10, 0, 1, -14)).filter(
    ImageFilter.GaussianBlur(14)
)
shadow_a = np.asarray(sh, np.float32) / 255 * 0.22 * (1 - m) * (1 - shirt[..., 1])


def over(dst: np.ndarray, src: np.ndarray) -> np.ndarray:
    """(회색, 알파) 레이어 알파 합성."""
    a = src[..., 1] + dst[..., 1] * (1 - src[..., 1])
    g = (src[..., 0] * src[..., 1] + dst[..., 0] * dst[..., 1] * (1 - src[..., 1])) / np.maximum(
        a, 1e-6
    )
    return np.stack([g, a], -1)


layer = np.zeros((H, PW, 2), np.float32)
layer[..., 1] = shadow_a
layer = over(layer, shirt)
layer = over(layer, tie_rgba)

# --- 아트 박스: 좌우로 넓혀 몸통 최대 폭이 아트 폭의 0.393(기존 TieCanvas 타일 배율과 같은 감각)
ART_PW = round(WMAX / 0.393)
pad = round(ART_PW / 2 - C)  # 넥타이 중심선을 아트 박스 정중앙에
OUT_W = 794
s = OUT_W / ART_PW
OUT_H = round(H * s)


def place(img: Image.Image) -> Image.Image:
    canvas = Image.new(img.mode, (ART_PW, H), 0)
    canvas.paste(img, (pad, 0))
    return canvas.resize((OUT_W, OUT_H), Image.Resampling.LANCZOS)


g = Image.fromarray(layer[..., 0].clip(0, 255).astype(np.uint8))
a = Image.fromarray((layer[..., 1] * 255).clip(0, 255).astype(np.uint8))
shadow = Image.merge("LA", (place(g), place(a)))
shadow.save(f"{out_dir}/tie-shadow.png", optimize=True)
# 웹(store·admin public/images)은 WebP — PNG는 600KB대라 첫 로딩이 무겁다.
# 알파 품질 60은 평균 차이는 작아도 밝은 넥타이 매듭 명암이 얼룩(포스터라이즈)진다
# — 80부터 PNG와 같다.
shadow.convert("RGBA").save(f"{out_dir}/tie-shadow.webp", quality=75, alpha_quality=80, method=6)
for name, mm in (("tie-mask.png", mask), ("tie-knot-mask.png", knot_mask)):
    am = place(mm)
    Image.merge("LA", (Image.new("L", am.size, 0), am)).save(f"{out_dir}/{name}", optimize=True)

print(f"OUT {OUT_W}x{OUT_H} knot {KT}-{KB} tip {BTIP} scale {s:.4f} pad {pad}")
print(
    f"knot center y frac {((KT + KB) / 2) / H:.4f}  tip frac {BTIP / H:.4f}",
    f"knot bottom frac {KB / H:.4f}",
)

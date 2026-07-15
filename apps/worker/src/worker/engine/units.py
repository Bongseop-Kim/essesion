"""단위 변환·수치 포매팅·각도/간격 스냅 (worker-engine.md §2·§9, 부록).

fmt의 처리 순서(.4f → 후행 0/점 제거 → -0 정규화)가 byte-identical의 핵심.
"""

import math
from dataclasses import dataclass
from fractions import Fraction

DEFAULT_DPI = 300
MM_PER_INCH = 25.4
ALLOWED_DPI = (150, 300, 600)

# 스냅된 대각 lane이 닫히기까지 지나는 타일 수 상한 (tan θ = p/q의 분모 캡)
MAX_LANE_PERIOD_TILES = 16


def mm_to_px(mm: float, dpi: int = DEFAULT_DPI) -> int:
    return round(mm / MM_PER_INCH * dpi)


def fmt(value: float) -> str:
    text = f"{float(value):.4f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-", "-0") else text


def nearest_dpi(dpi: int) -> int:
    return min(ALLOWED_DPI, key=lambda v: abs(v - dpi))


@dataclass(frozen=True)
class SnappedAngle:
    """타일-공약(rational slope p/q) 방향으로 스냅된 lane 각도. q=0은 수직."""

    angle_deg: float
    p: int
    q: int


def snap_angle(requested_deg: float) -> SnappedAngle:
    """기울기 tan θ를 유리수 p/q(분모 ≤ 16)로 근사해 토러스에서 닫히는 방향으로 스냅."""
    theta = ((requested_deg + 90.0) % 180.0) - 90.0
    cos_t = math.cos(math.radians(theta))
    if abs(abs(theta) - 90.0) < 1e-9 or abs(cos_t) < 1e-12:
        return SnappedAngle(90.0, 1, 0)

    slope = math.tan(math.radians(theta))
    abs_slope = abs(slope)
    sign = -1 if slope < 0 else 1
    if abs_slope <= 1.0:
        frac = Fraction(abs_slope).limit_denominator(MAX_LANE_PERIOD_TILES)
        p_abs, q = frac.numerator, frac.denominator
    else:
        # 수직에 가까우면 cot로 근사 후 역수 (조건수 개선)
        cot = Fraction(1.0 / abs_slope).limit_denominator(MAX_LANE_PERIOD_TILES)
        if cot.numerator == 0:
            return SnappedAngle(90.0, 1, 0)
        p_abs, q = cot.denominator, cot.numerator

    p = sign * p_abs
    angle = math.degrees(math.atan2(p, q))
    return SnappedAngle(angle, p, q)


def stripe_tiles(tile_mm: float, period_mm: float, p: int, q: int, tol: float = 1e-6) -> bool:
    """tile_mm == k·period_mm·hypot(p,q) (정수 k≥1)일 때만 stripe가 seamless."""
    if period_mm <= 0:
        return False
    hypot = math.hypot(p, q)
    if hypot == 0:
        return False
    k = tile_mm / (period_mm * hypot)
    if not math.isfinite(k):
        return False
    nearest = round(k)
    return nearest >= 1 and abs(nearest - k) <= tol * max(1.0, k)


def divides(whole: float, part: float, tol: float = 1e-6) -> bool:
    if part <= 0:
        return False
    ratio = whole / part
    if not math.isfinite(ratio):
        return False
    residue = round(ratio) * part - whole
    return abs(residue) <= tol * max(1.0, abs(whole))


def snap_spacing(closure_mm: float, spacing_mm: float) -> tuple[int, float]:
    """간격을 lane 폐곡선 길이의 정확한 약수로 스냅 — (개수, 유효 간격)."""
    if spacing_mm <= 0:
        raise ValueError(f"spacing_mm must be positive, got {spacing_mm}")
    ratio = closure_mm / spacing_mm
    if not math.isfinite(ratio):
        raise ValueError("spacing_mm is too small to produce a finite instance count")
    n = max(1, round(ratio))
    return n, closure_mm / n

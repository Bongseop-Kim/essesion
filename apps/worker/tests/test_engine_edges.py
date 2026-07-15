"""엔진 엣지 케이스 — 골든 미커버 경계의 단위 테스트 (원본 test_angle_snap/
test_scatter/test_placement_path/test_candidates에서 이식).

로직은 원본과 verbatim 동일 계약이므로 원본 테스트가 그대로 명세 역할을 한다.
"""

import math

import pytest
from worker.engine.candidates import generate_candidates
from worker.engine.intent import Placement, ScatterSpec
from worker.engine.placement import _torus_dist, place_scatter
from worker.engine.units import MAX_LANE_PERIOD_TILES, divides, snap_angle, snap_spacing

from .intent_helpers import mvp_intent, register_test_motifs

register_test_motifs()

TILE = 48.0


# --- snap_angle (commensurate 각도 스냅) ---------------------------------------


def test_snaps_minus_32_to_commensurate_rational():
    r = snap_angle(-32.0)
    assert (r.p, r.q) == (-5, 8)  # 분모 상한 내 최근접 유리수 기울기
    assert math.isclose(r.angle_deg, math.degrees(math.atan2(-5, 8)))
    assert r.q <= MAX_LANE_PERIOD_TILES


def test_snapped_lane_wraps_after_integer_tiles():
    r = snap_angle(-32.0)
    assert math.isclose(r.q * math.tan(math.radians(r.angle_deg)), r.p, abs_tol=1e-9)


def test_slope_is_lowest_terms():
    r = snap_angle(-32.0)
    assert math.gcd(abs(r.p), r.q) == 1


def test_zero_stays_horizontal():
    r = snap_angle(0.0)
    assert (r.p, r.q) == (0, 1)
    assert r.angle_deg == 0.0


@pytest.mark.parametrize("deg,p,q", [(45.0, 1, 1), (-45.0, -1, 1)])
def test_45_degrees_is_exact(deg, p, q):
    r = snap_angle(deg)
    assert (r.p, r.q) == (p, q)
    assert math.isclose(r.angle_deg, deg)


@pytest.mark.parametrize("deg", [90.0, 89.9, -90.0])
def test_vertical_and_near_vertical(deg):
    r = snap_angle(deg)
    assert r.q == 0  # 수직 lane
    assert r.angle_deg == 90.0


def test_sign_preserved_for_negative():
    r = snap_angle(-32.0)
    assert r.angle_deg < 0 and r.p < 0


@pytest.mark.parametrize("deg", [87.0, 88.0, 89.0, 89.5, 89.95])
def test_near_vertical_sweep_stays_valid(deg):
    r = snap_angle(deg)
    if r.q == 0:
        assert r.angle_deg == 90.0
    else:
        assert math.gcd(abs(r.p), r.q) == 1 and r.q <= MAX_LANE_PERIOD_TILES


def test_exact_rational_input_is_fixed_point():
    base = math.degrees(math.atan2(1, 2))
    r = snap_angle(base)
    assert (r.p, r.q) == (1, 2)


def test_idempotent_and_deterministic():
    r1 = snap_angle(-32.0)
    r2 = snap_angle(r1.angle_deg)
    assert (r2.p, r2.q) == (r1.p, r1.q)
    assert snap_angle(-32.0) == snap_angle(-32.0)


# --- snap_spacing / divides ----------------------------------------------------


def test_snap_spacing_divides_closure_exactly():
    closure = TILE * math.hypot(1, 1)  # 무리수 closure — 12.0은 나눠떨어지지 않는다
    n, eff = snap_spacing(closure, 12.0)
    assert eff * n == pytest.approx(closure)  # wrap 포함 n개의 균등 간격
    assert n == max(1, round(closure / 12.0))


def test_divides_tolerance_boundaries():
    assert divides(48.0, 12.0)
    assert divides(48.0, 16.0)
    assert not divides(48.0, 13.0)
    assert divides(TILE * math.hypot(1, 1), TILE * math.hypot(1, 1) / 4)


# --- poisson scatter (torus 거리) ----------------------------------------------


def _scatter(**kwargs) -> Placement:
    return Placement(type="scatter", scatter=ScatterSpec(**kwargs))


def test_torus_dist_wraps_around_edges():
    # (1,1)과 (47,47)은 유클리드로 멀지만 torus에서는 대각 √8.
    assert _torus_dist(1.0, 1.0, 47.0, 47.0, TILE) == pytest.approx(math.hypot(2, 2))
    assert _torus_dist(0.0, 24.0, 47.0, 24.0, TILE) == pytest.approx(1.0)


def test_poisson_is_deterministic_from_seed():
    p = _scatter(mode="poisson", min_dist_mm=8, count=6)
    assert place_scatter(p, TILE, seed=7) == place_scatter(p, TILE, seed=7)


def test_poisson_respects_torus_min_distance():
    p = _scatter(mode="poisson", min_dist_mm=8, count=6)
    inst = place_scatter(p, TILE, seed=7)
    for i in range(len(inst)):
        for j in range(i + 1, len(inst)):
            d = _torus_dist(inst[i].x_mm, inst[i].y_mm, inst[j].x_mm, inst[j].y_mm, TILE)
            assert d >= 8 - 1e-9


def test_poisson_respects_count_cap():
    p = _scatter(mode="poisson", min_dist_mm=6, count=5)
    inst = place_scatter(p, TILE, seed=3)
    assert 0 < len(inst) <= 5


def test_sateen_has_zero_alignment():
    inst = place_scatter(_scatter(mode="sateen", sateen_n=5, sateen_step=2), 50.0, seed=0)
    xs = [round(i.x_mm, 6) for i in inst]
    ys = [round(i.y_mm, 6) for i in inst]
    assert len(inst) == 5
    assert len(set(xs)) == 5 and len(set(ys)) == 5  # 행·열마다 정확히 한 점


# --- candidates de-dup·rank ----------------------------------------------------


def test_dedup_keeps_only_distinct_svgs():
    cs = generate_candidates(mvp_intent(), candidate_count=8)
    svgs = [c.candidate.svg for c in cs.candidates]
    assert len(set(svgs)) == len(svgs)


def test_candidates_are_rank_sorted():
    cs = generate_candidates(mvp_intent(), candidate_count=4)
    keys = [c.rank_key for c in cs.candidates]
    assert keys == sorted(keys)


def test_count_one_has_no_diversity_warning():
    cs = generate_candidates(mvp_intent(), candidate_count=1)
    assert len(cs.candidates) == 1
    assert all("diversity" not in w for w in cs.warnings)


def test_unknown_colorway_raises():
    with pytest.raises(ValueError):
        generate_candidates(mvp_intent(), candidate_count=2, colorway="nope")

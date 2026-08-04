"""fabric finalize 픽셀 결정론·seam·relief·모티프 인레이 (worker-pipeline.md §2·§5).

원본 seamless-tile test_fabric의 명세를 재현하되 essesion 재설계(렌더 1~4회, 라벨 세그,
기하학 모티프 마스크)를 검증한다. 에셋 비의존을 위해 합성 64² 저주파 weave 7종을
`_weave_bytes` monkeypatch로 주입한다(실 렌더는 rsvg-convert 필요 — 없으면 skip).
"""

import io
import math
from fractions import Fraction
from shutil import which
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageChops, ImageStat
from worker.config import get_settings
from worker.db import get_session
from worker.engine.validate import validate_intent
from worker.main import create_app
from worker.motifs.registry import MotifDef, register_motif
from worker.render import fabric, inlay, motif_mask, weave
from worker.render import segment as segment_mod

from .conftest import FakeObjectStore
from .intent_helpers import register_test_motifs

register_test_motifs()

# circle과 같은 원 geometry에 색만 다른 모티프 — 마스크의 색 비의존 고정용.
# pale은 _low_contrast_intent의 ground와 Δ≤3, twin은 accent와 완전히 같은 색이다.
for _motif_id, _fill in (("circle_pale", "#f2ede3"), ("circle_twin", "#8fb4c9")):
    register_motif(
        MotifDef(
            id=_motif_id,
            symbol=(
                f'<symbol id="motif-{_motif_id}" overflow="visible">'
                f'<circle cx="0" cy="0" r="0.5" fill="{_fill}"/></symbol>'
            ),
        )
    )

pytestmark = pytest.mark.skipif(
    which("rsvg-convert") is None and which("resvg") is None,
    reason="fabric 실 렌더에는 rsvg-convert/resvg 시스템 렌더러가 필요",
)

_WEAVE_NAMES = ("check", "herringbone", "jacquard", "pindot", "solid", "twill-0", "twill-45")


def _synth_weave(name: str, size: int = 64) -> bytes:
    """이름에서 결정되는 seamless 저주파 64² weave. 평균 휘도·주파수가 이름마다 달라
    서로 구별되고, relief용 휘도 변화도 갖는다(solid는 저대비)."""
    h = sum(ord(c) for c in name)
    freq = 1 + (h % 3)
    base = 110 + (h % 5) * 20
    amp = 6 if name == "solid" else 34
    img = Image.new("RGB", (size, size))
    px = img.load()
    assert px is not None
    for y in range(size):
        for x in range(size):
            v = base + int(
                amp
                * math.sin(2 * math.pi * freq * x / size)
                * math.cos(2 * math.pi * freq * y / size)
            )
            v = max(0, min(255, v))
            px[x, y] = (v, v, v)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def weaves(monkeypatch):
    """합성 weave를 weave_bytes로 주입하고 이미지 캐시를 격리한다."""
    table = {name: _synth_weave(name) for name in _WEAVE_NAMES}
    monkeypatch.setattr(weave, "weave_bytes", lambda name: table[name])
    weave.weave_image.cache_clear()
    yield
    weave.weave_image.cache_clear()


# --- intent 헬퍼 -------------------------------------------------------------


def _palette():
    return {
        "slots": [{"id": "ground", "hex": "#10243a"}, {"id": "accent", "hex": "#ef8a7a"}],
    }


def _colorways():
    return [{"id": "default", "name": "d", "mapping": {"ground": "#10243a", "accent": "#ef8a7a"}}]


def _print_intent(tile_mm=24, dpi=150):
    return {
        "intent_version": 1,
        "canvas": {"tile_mm": tile_mm, "dpi": dpi},
        "seed": 3,
        "production": {"method": "print", "max_colors": 12},
        "palette": _palette(),
        "colorways": _colorways(),
        "layers": [
            {"id": "bg", "type": "background", "z_order": 0, "params": {"color": "ground"}},
            {
                "id": "stripe",
                "type": "stripe",
                "z_order": 1,
                "params": {
                    "angle": 0,
                    "period_mm": 8,
                    "bands": [{"offset_mm": 0, "width_mm": 4, "color": "accent"}],
                },
            },
        ],
    }


def _yarn_no_motif_intent(tile_mm=24, dpi=150):
    intent = _print_intent(tile_mm, dpi)
    intent["production"]["method"] = "yarn_dyed"
    return intent


def _yarn_motif_intent(tile_mm=24, dpi=150, size_mm=6, phase_mm=0.0):
    return {
        "intent_version": 1,
        "canvas": {"tile_mm": tile_mm, "dpi": dpi},
        "seed": 7,
        "production": {"method": "yarn_dyed", "max_colors": 12},
        "palette": _palette(),
        "colorways": _colorways(),
        "layers": [
            {"id": "bg", "type": "background", "z_order": 0, "params": {"color": "ground"}},
            {
                "id": "dots",
                "type": "motif",
                "z_order": 1,
                "params": {"motif_id": "circle", "size_mm": size_mm},
                "placement": {
                    "type": "lattice",
                    "phase_mm": phase_mm,
                    "lattice": {"cell_w_mm": 12, "cell_h_mm": 12},
                },
            },
        ],
    }


def _low_contrast_intent(motif_id="circle", tile_mm=24, dpi=150):
    """모티프 실루엣이 색으로는 안 보이는 배치.

    ground(#f5efe4)는 circle_pale과 Δ≤3이고, accent 스트라이프(#8fb4c9)는 circle_twin과
    완전히 같은 색이다. 격자 원은 스트라이프 경계를 가로지르므로 twin은 한 도형이 두
    조각으로 갈라지는 재현이 된다.
    """
    return {
        "intent_version": 1,
        "canvas": {"tile_mm": tile_mm, "dpi": dpi},
        "seed": 11,
        "production": {"method": "yarn_dyed", "max_colors": 12},
        "palette": {
            "slots": [{"id": "ground", "hex": "#f5efe4"}, {"id": "accent", "hex": "#8fb4c9"}],
        },
        "colorways": [
            {"id": "default", "name": "d", "mapping": {"ground": "#f5efe4", "accent": "#8fb4c9"}}
        ],
        "layers": [
            {"id": "bg", "type": "background", "z_order": 0, "params": {"color": "ground"}},
            {
                "id": "stripe",
                "type": "stripe",
                "z_order": 1,
                "params": {
                    "angle": 0,
                    "period_mm": 12,
                    "bands": [{"offset_mm": 0, "width_mm": 6, "color": "accent"}],
                },
            },
            {
                "id": "dots",
                "type": "motif",
                "z_order": 2,
                "params": {"motif_id": motif_id, "size_mm": 6},
                "placement": {
                    "type": "lattice",
                    "lattice": {"cell_w_mm": 12, "cell_h_mm": 12},
                },
            },
        ],
    }


def _coverage(intent):
    result = validate_intent(intent)
    return motif_mask.motif_coverage_mask(result.intent, result.palette, dpi=150, tile_mm=24)


def _render(intent, **params):
    params.setdefault("dpi", 150)  # 세그·마스크 대조가 같은 dpi를 쓰도록 고정
    return fabric.render_fabric({"intent": intent, **params}, get_settings())


def _img(png: bytes) -> Image.Image:
    return Image.open(io.BytesIO(png)).convert("RGB")


# --- seam 헬퍼 ---------------------------------------------------------------


def _mean_abs(a: Image.Image, b: Image.Image) -> float:
    return max(ImageStat.Stat(ImageChops.difference(a, b)).mean)


def _seam_scores(img: Image.Image):
    """(가로 seam, 가로 내부 최대, 세로 seam, 세로 내부 최대) 인접 픽셀 평균 절대차."""
    w, h = img.size

    def col(x):
        return img.crop((x, 0, x + 1, h))

    def row(y):
        return img.crop((0, y, w, y + 1))

    h_seam = _mean_abs(col(w - 1), col(0))  # 마지막 열은 다음 tile의 첫 열과 인접
    v_seam = _mean_abs(row(h - 1), row(0))
    step_x = max(1, w // 16)
    step_y = max(1, h // 16)
    h_int = max(_mean_abs(col(x), col(x + 1)) for x in range(0, w - 1, step_x))
    v_int = max(_mean_abs(row(y), row(y + 1)) for y in range(0, h - 1, step_y))
    return h_seam, h_int, v_seam, v_int


def _assert_seamless(img: Image.Image, *, k: float = 3.0, floor: float = 14.0):
    """seam 인접 차가 내부 최대 인접 차의 k배(또는 절대 floor) 이내 — 이음매 불연속 없음."""
    h_seam, h_int, v_seam, v_int = _seam_scores(img)
    assert h_seam <= max(h_int * k, floor), f"horizontal seam {h_seam:.2f} vs interior {h_int:.2f}"
    assert v_seam <= max(v_int * k, floor), f"vertical seam {v_seam:.2f} vs interior {v_int:.2f}"


# --- 1. 결정론 --------------------------------------------------------------


def test_print_render_is_deterministic(weaves):
    intent = _print_intent()
    assert _render(intent, weave="twill-45") == _render(intent, weave="twill-45")


def test_yarn_no_motif_render_is_deterministic(weaves):
    intent = _yarn_no_motif_intent()
    a = _render(intent, weave="twill-0", material_map={"accent": "solid"})
    b = _render(intent, weave="twill-0", material_map={"accent": "solid"})
    assert a == b


def test_yarn_motif_render_is_deterministic(weaves):
    intent = _yarn_motif_intent()
    assert _render(intent, weave="twill-45") == _render(intent, weave="twill-45")


# --- 2. material_map --------------------------------------------------------


def test_material_map_none_equals_empty(weaves):
    """None·{} 는 균일 weave와 byte-identical (map 분기 자체가 사라진다)."""
    intent = _yarn_no_motif_intent()
    uniform = _render(intent, weave="twill-0")
    assert _render(intent, weave="twill-0", material_map=None) == uniform
    assert _render(intent, weave="twill-0", material_map={}) == uniform


def test_material_map_partial_falls_back_to_base(weaves):
    """부분 map은 지정 슬롯만 override; 미지정 슬롯 영역은 base weave 그대로."""
    intent = _yarn_no_motif_intent()
    base = _img(_render(intent, weave="twill-0"))
    mapped = _img(_render(intent, weave="twill-0", material_map={"accent": "solid"}))

    result = validate_intent(intent)
    seg = segment_mod.segment(result.intent, result.palette, dpi=150, tile_mm=24)
    ground_mask = segment_mod.mask_for(seg.slot_index, seg.index_for["ground"])
    accent_mask = segment_mod.mask_for(seg.slot_index, seg.index_for["accent"])

    # ground(미지정)는 base와 동일, accent(지정)는 달라진다
    assert (
        _mean_abs(
            Image.composite(base, Image.new("RGB", base.size), ground_mask),
            Image.composite(mapped, Image.new("RGB", base.size), ground_mask),
        )
        < 1.0
    )
    assert (
        _mean_abs(
            Image.composite(base, Image.new("RGB", base.size), accent_mask),
            Image.composite(mapped, Image.new("RGB", base.size), accent_mask),
        )
        > 2.0
    )


# --- 3·7. seam --------------------------------------------------------------


def test_print_render_is_seamless(weaves):
    _assert_seamless(_img(_render(_print_intent(), weave="twill-45")))


def test_motif_render_is_seamless(weaves):
    _assert_seamless(_img(_render(_yarn_motif_intent(), weave="twill-45")))


def test_boundary_motif_keeps_seam_phase(weaves):
    """tile 경계를 걸치도록 배치된 모티프도 인레이 위상이 이어져 seam이 연속."""
    intent = _yarn_motif_intent(phase_mm=6.0)  # 격자를 반칸 밀어 경계에 모티프가 걸침
    _assert_seamless(_img(_render(intent, weave="twill-45")))


# --- 4·9. relief ------------------------------------------------------------


def test_relief_zero_differs_from_default_and_is_stable(weaves):
    """relief_strength=0 은 relief를 전부 끄고(기본값과 달라야 함) 결정론적이다."""
    intent = _yarn_motif_intent()
    off = _render(intent, weave="twill-45", relief_strength=0.0)
    assert off == _render(intent, weave="twill-45", relief_strength=0.0)
    assert off != _render(intent, weave="twill-45", relief_strength=0.45)


def test_print_ignores_relief(weaves):
    intent = _print_intent()
    assert _render(intent, weave="twill-45", relief_strength=5.0) == _render(
        intent, weave="twill-45", relief_strength=0.0
    )


def test_negative_strength_rejected(weaves):
    intent = _yarn_no_motif_intent()
    with pytest.raises(fabric.FabricError):
        _render(intent, weave="twill-0", relief_strength=-0.1)
    with pytest.raises(fabric.FabricError):
        _render(intent, weave="twill-0", texture_strength=-1.0)


# --- 5. 모티프 실 = twill-45 고정 -------------------------------------------


def test_motif_thread_fixed_to_twill45(weaves):
    """모티프 가닥 픽셀은 base weave/material_map과 무관(항상 F × twill-45)."""
    intent = _yarn_motif_intent()
    a = _img(_render(intent, weave="twill-0", relief_strength=0.0))
    b = _img(_render(intent, weave="check", relief_strength=0.0))

    result = validate_intent(intent)
    coverage = motif_mask.motif_coverage_mask(result.intent, result.palette, dpi=150, tile_mm=24)
    thread = inlay.motif_thread_mask(coverage, dpi=150)
    solid_thread = thread.point([0] * 200 + [255] * 56)  # L 모드 LUT — v>=200 이진화

    # 가닥 내부는 base weave가 달라도 동일, base 영역(가닥 밖)은 달라야 한다
    assert (
        _mean_abs(
            Image.composite(a, Image.new("RGB", a.size), solid_thread),
            Image.composite(b, Image.new("RGB", a.size), solid_thread),
        )
        < 1.0
    )
    assert _mean_abs(a, b) > 2.0


def test_motif_mask_is_independent_of_motif_color(weaves):
    """마스크는 기하학이다 — 같은 도형이면 모티프 색이 무엇이든 byte-identical.

    (a) 모티프가 바탕과 거의 같은 색이면 마스크가 통째로 비고, (b) 팔레트 색과 겹치면
    실루엣이 스트라이프 경계에서 잘려 한 도형이 두 조직으로 쪼개지던 회귀를 고정한다.
    """
    contrasting = _coverage(_low_contrast_intent("circle"))
    pale = _coverage(_low_contrast_intent("circle_pale"))  # (a) ground와 Δ≤3
    twin = _coverage(_low_contrast_intent("circle_twin"))  # (b) accent와 동일 색

    assert contrasting.getbbox() is not None
    assert pale.tobytes() == contrasting.tobytes()
    assert twin.tobytes() == contrasting.tobytes()


def test_occluded_motif_is_excluded_from_the_mask(weaves):
    """z-order상 위 레이어에 가려진 모티프 픽셀은 마스크에서 빠진다(색 무관)."""
    intent = _low_contrast_intent("circle")
    visible = _coverage(intent)
    intent["layers"][1]["z_order"] = 3  # 스트라이프를 모티프 위로
    occluded = _coverage(intent)

    assert occluded.getbbox() is not None
    assert ImageStat.Stat(occluded).sum[0] < ImageStat.Stat(visible).sum[0]


def test_low_contrast_motif_is_still_inlaid(weaves):
    """ground와 Δ≤3인 모티프도 실 인레이가 남는다 — 통째로 증발하던 회귀 고정.

    스트라이프를 빼 대비가 남는 영역이 하나도 없게 만든 배치다: 색 차 기반 마스크는
    완전히 비어 yarn_dyed 출력이 모티프 없는 렌더와 byte-identical이 됐다.
    """
    intent = _low_contrast_intent("circle_pale")
    intent["layers"] = [la for la in intent["layers"] if la["id"] != "stripe"]
    without = dict(intent, layers=[la for la in intent["layers"] if la["type"] != "motif"])
    # relief를 꺼서 두 경로의 유일한 차이가 실 인레이가 되게 한다.
    with_motif = _img(_render(intent, weave="twill-0", relief_strength=0.0))
    base_only = _img(_render(without, weave="twill-0", relief_strength=0.0))
    assert _mean_abs(with_motif, base_only) > 1.0


def test_fully_occluded_motif_keeps_slot_relief(weaves):
    """마스크가 비어도 relief 경로는 그대로 — 안 보이는 레이어가 슬롯 경계 emboss를 끄면 안 된다."""
    intent = _low_contrast_intent("circle")
    intent["layers"][2]["z_order"] = -1  # 불투명 배경 아래로 — 모티프는 완전히 가려진다
    assert _coverage(intent).getbbox() is None
    assert _render(intent, weave="twill-0", relief_strength=0.6) != _render(
        intent, weave="twill-0", relief_strength=0.0
    )


# --- 6. thread_period_width -------------------------------------------------


def test_thread_period_width_near_target():
    dpi = 300
    target = max(2.0, inlay.THREAD_PERIOD_MM * dpi / 25.4)
    step, width = inlay.thread_period_width((787, 787), dpi=dpi)  # 소수 정사각 tile
    assert isinstance(step, Fraction)
    # 유리수 step은 소수 크기에서도 mm 목표에 근접 — 정수-약수 탐색의 붕괴(step≈tile)를 피함
    assert abs(float(step) - target) < 1.0
    assert 1 <= width < math.ceil(step)


def test_thread_period_phase_invariant_under_tile_shift():
    """int(k*step) 라인 위치는 w/h(step의 배수) shift에 불변 — seam 위상 연속의 근거."""
    w, h = 512, 512
    step, _ = inlay.thread_period_width((w, h), dpi=300)
    lines = {int(k * step) for k in range(64)}
    shifted = {int(k * step) - w for k in range(64)}  # w만큼 민 위상
    # w는 step의 정수배라 시프트한 라인군이 원래 라인군에 포함된다
    assert (lines & {s + w for s in shifted}) == lines


def test_motif_inlay_pixel_guard(weaves):
    """모티프 인레이 경로는 픽셀 수 상한(20M)을 넘으면 렌더 전에 FabricError."""
    intent = _yarn_motif_intent(tile_mm=192)  # 격자 셀 12mm이 나누어떨어짐
    with pytest.raises(fabric.FabricError, match="motif inlay exceeds"):
        _render(intent, weave="twill-45", dpi=600)  # 4535² ≈ 20.6M px


# --- 8. 렌더 카운트 ---------------------------------------------------------


def test_rasterize_call_counts(weaves, monkeypatch):
    from worker.render import raster

    counter = {"n": 0}
    orig = raster.rasterize_svg

    def counting(svg, **kwargs):
        counter["n"] += 1
        return orig(svg, **kwargs)

    monkeypatch.setattr(raster, "rasterize_svg", counting)

    def count(intent, **params):
        counter["n"] = 0
        _render(intent, **params)
        return counter["n"]

    assert count(_print_intent(), weave="twill-45") == 1
    # yarn_dyed는 relief 기본값(0.45)이 켜져 있어 라벨 세그 1회가 추가된다
    assert count(_yarn_no_motif_intent(), weave="twill-0", relief_strength=0.0) == 1
    assert count(_yarn_no_motif_intent(), weave="twill-0") == 2  # 기본 relief > 0
    # full 실색 + base 실색 + 모티프 기하 마스크
    assert count(_yarn_motif_intent(), weave="twill-45", relief_strength=0.0) == 3
    # 모티프 relief는 base 슬롯 경계를 위한 라벨 렌더를 한 번 더 사용한다.
    assert count(_yarn_motif_intent(), weave="twill-45") == 4
    assert count(_yarn_motif_intent(), weave="twill-45", material_map={"accent": "solid"}) == 4


# --- 9. 게이트 거부 ---------------------------------------------------------


def test_gate_rejections(weaves):
    def render_raises(intent, **params):
        with pytest.raises(fabric.FabricError):
            _render(intent, **params)

    # print + material_map
    render_raises(_print_intent(), weave="twill-45", material_map={"accent": "solid"})
    # print + non-twill weave
    render_raises(_print_intent(), weave="check")
    # unknown weave
    render_raises(_yarn_no_motif_intent(), weave="burlap")
    # material_map unknown slot
    render_raises(_yarn_no_motif_intent(), weave="twill-0", material_map={"nope": "solid"})
    # material_map unknown weave
    render_raises(_yarn_no_motif_intent(), weave="twill-0", material_map={"accent": "burlap"})
    # unknown colorway
    render_raises(_yarn_no_motif_intent(), weave="twill-0", colorway_id="missing")


# --- 10. /tasks/finalize 통합 -----------------------------------------------


class _FakeFinalizeSession:
    """finalize 라우트가 쓰는 최소 세션 — 준비한 job을 FOR UPDATE 조회에 그대로 돌려준다."""

    def __init__(self, job):
        self.job = job

    async def scalar(self, _stmt):
        return self.job

    async def scalars(self, _stmt):
        # 모티프 카탈로그 조회용 — 빈 결과면 렌더는 전역 registry로 폴백한다
        class _Empty:
            def all(self):
                return []

        return _Empty()

    async def commit(self):
        pass


def _finalize_app(monkeypatch, job):
    app = create_app()
    app.state.object_store = FakeObjectStore()

    async def _session():
        yield _FakeFinalizeSession(job)

    app.dependency_overrides[get_session] = _session
    return app


def test_finalize_route_succeeds(weaves, monkeypatch):
    import uuid

    job = SimpleNamespace(
        id=uuid.uuid4(),
        kind="finalize",
        status="queued",
        attempts=0,
        result=None,
        error_message=None,
        params={"intent": _yarn_motif_intent(), "weave": "twill-45", "dpi": 150},
    )
    client = TestClient(_finalize_app(monkeypatch, job))
    resp = client.post("/tasks/finalize", json={"job_id": str(job.id)})
    assert resp.status_code == 200
    assert resp.json()["status"] == "succeeded"
    assert job.status == "succeeded"
    assert job.result["object_key"].startswith("fabric/")


def test_finalize_route_fabric_error_records_failed_and_returns_200(weaves, monkeypatch):
    import uuid

    job = SimpleNamespace(
        id=uuid.uuid4(),
        kind="finalize",
        status="queued",
        attempts=0,
        result=None,
        error_message=None,
        params={"intent": _print_intent(), "weave": "check"},  # print + non-twill → FabricError
    )
    client = TestClient(_finalize_app(monkeypatch, job))
    resp = client.post("/tasks/finalize", json={"job_id": str(job.id)})
    assert resp.status_code == 200  # 영구 실패 — Cloud Tasks 재시도 안 함
    assert resp.json()["status"] == "failed"
    assert job.status == "failed"
    assert job.error_message

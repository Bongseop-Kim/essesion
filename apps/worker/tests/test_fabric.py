"""fabric finalize 픽셀 결정론·seam·relief·모티프 인레이 (worker-pipeline.md §2·§5).

원본 seamless-tile test_fabric의 명세를 재현하되 essesion 재설계(렌더 2~3회, 별칭 세그)를
검증한다. 에셋 비의존을 위해 합성 64² 저주파 weave 7종을 `_weave_bytes` monkeypatch로
주입한다(실 렌더는 rsvg-convert 필요 — 없으면 skip).
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
from worker.integrations import DryRunObjectStore
from worker.main import create_app
from worker.render import fabric, inlay, weave
from worker.render import segment as segment_mod

from .intent_helpers import register_test_motifs

register_test_motifs()

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
                "params": {"motif_id": "circle", "size_mm": size_mm, "color": "accent"},
                "placement": {
                    "type": "lattice",
                    "phase_mm": phase_mm,
                    "lattice": {"cell_w_mm": 12, "cell_h_mm": 12},
                },
            },
        ],
    }


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
    seg = segment_mod.segment(
        result.intent, result.palette, dpi=150, tile_mm=24, split_motifs=False
    )
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
    seg = segment_mod.segment(result.intent, result.palette, dpi=150, tile_mm=24, split_motifs=True)
    thread: Image.Image | None = None
    for mask in seg.motif_masks.values():
        strand = inlay.motif_thread_mask(mask, dpi=150)
        thread = strand if thread is None else ImageChops.lighter(thread, strand)
    assert thread is not None
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
    assert count(_yarn_motif_intent(), weave="twill-45", relief_strength=0.0) == 2
    assert count(_yarn_motif_intent(), weave="twill-45", material_map={"accent": "solid"}) == 3


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

    async def commit(self):
        pass


def _finalize_app(monkeypatch, job):
    app = create_app()
    app.state.object_store = DryRunObjectStore()

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

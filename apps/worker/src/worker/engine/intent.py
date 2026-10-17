"""intent 스키마 — 구조 검증(pydantic). 교차 검증·repair는 engine.validate (worker-engine.md §1)."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Canvas(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tile_mm: float = Field(gt=0)
    dpi: int = 300


class Production(BaseModel):
    model_config = ConfigDict(extra="forbid")

    method: Literal["yarn_dyed", "print"] = "print"
    max_colors: int = Field(default=12, gt=0)


class ColorSlotSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    hex: str
    spot: str | None = None
    name: str | None = None


class PaletteSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slots: list[ColorSlotSpec] = Field(min_length=1, max_length=64)


class ColorwaySpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str | None = None
    mapping: dict[str, str]


class PathSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["straight", "wave"] = "straight"
    angle: float | None = None
    wavelength: float | None = Field(default=None, gt=0)
    amplitude: float | None = Field(default=None, ge=0)


class LatticeSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cell_w_mm: float = Field(gt=0)
    cell_h_mm: float = Field(gt=0)
    drop_fraction: float | None = Field(default=None, gt=0, lt=1)
    drop_axis: Literal["row", "column"] = "column"
    # 격자 전체의 위상 이동. 인스턴스는 항상 tile로 modulo되므로 seamless 불변식은 그대로다.
    # 두 번째 모티프 슬롯이 첫 슬롯과 같은 격자에서 엇갈리게 놓이는 유일한 축이다.
    offset_x_mm: float = Field(default=0.0, allow_inf_nan=False)
    offset_y_mm: float = Field(default=0.0, allow_inf_nan=False)


class ScatterSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["poisson", "sateen"] = "poisson"
    min_dist_mm: float | None = Field(default=None, gt=0)
    count: int | None = Field(default=None, gt=0, le=10_000)
    sateen_n: int | None = Field(default=None, gt=1, le=1_024)
    sateen_step: int | None = Field(default=None, gt=0, le=1_024)
    # 레이어별 난수열 분리 — 같은 산개 설정의 두 슬롯이 정확히 같은 좌표에 놓이지 않게 한다.
    # 격자의 offset_x/y_mm와 같은 역할. 없으면 전역 seed를 그대로 써서 기존 intent는
    # byte-identical하게 재현된다(worker-engine.md §3).
    seed_salt: str | None = Field(default=None, min_length=1, max_length=64)


class PointSetSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    points: list[tuple[float, float]] = Field(min_length=1, max_length=10_000)


class Placement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["lattice", "point_set", "path_following", "scatter"]
    host_layer: str | None = None
    lane: str | None = None
    path: PathSpec | None = None
    spacing_mm: float | None = Field(default=None, gt=0)
    phase_mm: float = 0.0
    rotation: Literal["follow_path", "fixed"] | None = None
    # None은 canonical layout JSON에서 생략한다. 방향을 지정하면 고정 각도를 기록한다.
    fixed_rotation_deg: float | None = Field(default=None, ge=-360.0, le=360.0)
    lattice: LatticeSpec | None = None
    scatter: ScatterSpec | None = None
    point_set: PointSetSpec | None = None
    # 앞서 그려지는 모티프 레이어 id — 그 인스턴스와 외접원이 겹치는 자기 인스턴스를 뺀다
    # (worker-engine.md §3). None은 dump에서 생략돼 기존 intent는 byte-identical하다.
    avoid_layer: str | None = None

    @model_validator(mode="after")
    def _spec_matches_type(self) -> "Placement":
        specs = {"lattice": self.lattice, "scatter": self.scatter, "point_set": self.point_set}
        expected = self.type if self.type in specs else None
        for name, spec in specs.items():
            if name == expected:
                if spec is None:
                    raise ValueError(f"{self.type} placement requires a `{name}` spec")
            elif spec is not None:
                if expected is None:
                    raise ValueError(f"{self.type} placement does not accept `{name}`")
                raise ValueError(
                    f"{self.type} placement does not accept `{name}`; use `{expected}`"
                )
        return self


class BackgroundParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    color: str


class Band(BaseModel):
    model_config = ConfigDict(extra="forbid")

    offset_mm: float
    width_mm: float = Field(gt=0)
    color: str


class StripeParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    angle: float
    period_mm: float = Field(gt=0)
    bands: list[Band] = Field(min_length=1, max_length=256)


class MotifParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    motif_id: str
    size_mm: float = Field(gt=0)


class BackgroundLayer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    type: Literal["background"]
    params: BackgroundParams
    z_order: int
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)
    clip: str | None = None


class StripeLayer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    type: Literal["stripe"]
    params: StripeParams
    z_order: int
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)
    clip: str | None = None


class MotifLayer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    type: Literal["motif"]
    params: MotifParams
    placement: Placement | None = None
    z_order: int
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)
    clip: str | None = None


Layer = Annotated[BackgroundLayer | StripeLayer | MotifLayer, Field(discriminator="type")]

# 배치형(panel) — 블레이드에 한 번만 놓이는 요소(worker-engine.md §2b). 좌표는 블레이드 프레임:
# x 0..1000 = 블레이드 폭(왼→오, 어깨 기준), y는 같은 단위(위→아래)로 어깨선(끝이 좁아지기
# 시작하는 줄)이 1000, 끝 ≈ 1500. 등방 단위라 평면 카드·실사 컷 어디서든 모양이 같다.
PanelPoint = tuple[
    Annotated[float, Field(ge=-10_000, le=10_000)], Annotated[float, Field(ge=-10_000, le=10_000)]
]


class PanelRegion(BaseModel):
    """다각형 채움 — 대각·V 분할."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["region"]
    points: list[PanelPoint] = Field(min_length=3, max_length=64)
    color: str


class PanelLine(BaseModel):
    """폴리라인 — 사선 한 줄, 세로 금선. `end_dot`은 끝점의 점 지름."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["line"]
    points: list[PanelPoint] = Field(min_length=2, max_length=64)
    width: float = Field(gt=0, le=1_000)
    color: str
    end_dot: float | None = Field(default=None, gt=0, le=1_000)


class PanelCurveBand(BaseModel):
    """3차 베지어 띠 — 점 3n+1개(시작, 제어1, 제어2, 끝, …). 여러 개를 겹쳐 겹띠를 만든다."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["curve_band"]
    points: list[PanelPoint] = Field(min_length=4, max_length=64)
    width: float = Field(gt=0, le=1_000)
    color: str

    @model_validator(mode="after")
    def _cubic_segments(self) -> "PanelCurveBand":
        if (len(self.points) - 1) % 3:
            raise ValueError("curve_band needs 3n+1 points (cubic bezier segments)")
        return self


class PanelMotif(BaseModel):
    """모티프 한 번 — 넝쿨·붓 터치·포인트 로고. `size`는 같은 면적의 정사각 한 변(면적 기준)."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["motif"]
    motif_id: str
    at: PanelPoint
    size: float = Field(gt=0, le=5_000)
    rotation: float = Field(default=0.0, ge=-360.0, le=360.0)
    anchor: Literal["center", "bottom_right"] = "center"
    role: Literal["logo", "decor"] = "decor"


PanelElement = Annotated[
    PanelRegion | PanelLine | PanelCurveBand | PanelMotif, Field(discriminator="type")
]


class Intent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    intent_version: int = 1
    canvas: Canvas
    seed: int = 0
    production: Production = Field(default_factory=Production)
    palette: PaletteSpec
    colorways: list[ColorwaySpec] = Field(min_length=1, max_length=32)
    layers: list[Layer] = Field(min_length=1, max_length=64)
    # 비면 None — 기존 intent의 dump·layout_id가 바이트 단위로 그대로다(exclude_none).
    panel: list[PanelElement] | None = Field(default=None, min_length=1, max_length=32)

    @model_validator(mode="after")
    def _one_panel_logo(self) -> "Intent":
        logos = [e for e in self.panel or () if e.type == "motif" and e.role == "logo"]
        if len(logos) > 1:
            raise ValueError("panel may hold at most one logo motif")
        return self

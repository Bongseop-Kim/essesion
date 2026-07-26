/* DesignPlanV3의 관리자 저작용 TS 미러. 서버 계약은 worker.authoring.schema.DesignPlanV3이며
   범위·enum은 그쪽이 정본이다. 여기서는 피커가 애초에 잘못된 값을 만들지 못하게 하는 데만 쓰고,
   검증 자체는 프리뷰 응답(서버)에 맡긴다. */

export type StripeDirection =
  | "horizontal"
  | "vertical"
  | "diagonal_up"
  | "diagonal_down";

export type PathDirection =
  | StripeDirection
  | "diagonal_2_3_up"
  | "diagonal_2_3_down";

export type PlanMotifSource = { source: "input"; input_index: number };

export type StripeBand = {
  offset_ratio: number;
  width_ratio: number;
  color_index: number;
};

export type StripeLayer = {
  type: "stripe";
  direction: StripeDirection;
  period_ratio: number;
  bands: StripeBand[];
};

export type LatticePlacement = {
  type: "lattice";
  columns: number;
  rows: number;
  drop: "none" | "half_row" | "half_column";
  fixed_rotation_deg: number;
};

export type PoissonScatterPlacement = {
  type: "scatter";
  mode: "poisson";
  count: number;
  min_distance_ratio: number;
  fixed_rotation_deg: number;
};

export type SateenScatterPlacement = {
  type: "scatter";
  mode: "sateen";
  order: number;
  step: number;
  fixed_rotation_deg: number;
};

export type StraightPathPlacement = {
  type: "path";
  kind: "straight";
  direction: PathDirection;
  spacing_ratio: number;
  phase_ratio: number;
  host_stripe_index?: number | null;
  host_band_index?: number | null;
  rotation: "follow_path" | "fixed";
  fixed_rotation_deg: number;
};

export type WavePathPlacement = {
  type: "path";
  kind: "wave";
  direction: PathDirection;
  spacing_ratio: number;
  phase_ratio: number;
  wavelength_ratio: number;
  amplitude_ratio: number;
  rotation: "follow_path" | "fixed";
  fixed_rotation_deg: number;
};

export type PointTemplatePlacement = {
  type: "point_template";
  template: "quincunx_inset" | "diagonal_pair" | "grid4_inset";
  fixed_rotation_deg: number;
};

export type Placement =
  | LatticePlacement
  | PoissonScatterPlacement
  | SateenScatterPlacement
  | StraightPathPlacement
  | WavePathPlacement
  | PointTemplatePlacement;

export type MotifLayer = {
  type: "motif";
  motif_index: number;
  size_ratio: number;
  color_indices?: number[] | null;
  placement: Placement;
};

export type PlanLayer = StripeLayer | MotifLayer;

export type DesignPlan = {
  colors: string[];
  ground_color_index: number;
  motifs: PlanMotifSource[];
  layers: PlanLayer[];
};

/** 배치 종류 — 스키마의 type+mode/kind 조합을 피커 한 개로 다루기 위한 평탄화 키 */
export type PlacementKind =
  | "lattice"
  | "scatter_poisson"
  | "scatter_sateen"
  | "path_straight"
  | "path_wave"
  | "point_template";

export const MAX_COLORS = 8;
export const MIN_COLORS = 2;
export const MAX_LAYERS = 4;
export const MAX_BANDS = 4;
export const MAX_MOTIFS = 2;

export const STRIPE_DIRECTION_LABELS: Record<StripeDirection, string> = {
  horizontal: "가로",
  vertical: "세로",
  diagonal_up: "우상향 대각",
  diagonal_down: "우하향 대각",
};

export const PATH_DIRECTION_LABELS: Record<PathDirection, string> = {
  ...STRIPE_DIRECTION_LABELS,
  diagonal_2_3_up: "2:3 우상향 대각",
  diagonal_2_3_down: "2:3 우하향 대각",
};

export const DROP_LABELS: Record<LatticePlacement["drop"], string> = {
  none: "없음",
  half_row: "행 반칸 밀기",
  half_column: "열 반칸 밀기",
};

export const POINT_TEMPLATE_LABELS: Record<
  PointTemplatePlacement["template"],
  string
> = {
  quincunx_inset: "오점형 (4각 + 중앙)",
  diagonal_pair: "대각 2점",
  grid4_inset: "4점 격자",
};

export const ROTATION_LABELS: Record<
  StraightPathPlacement["rotation"],
  string
> = {
  follow_path: "경로 방향 따라가기",
  fixed: "고정 각도",
};

export const PLACEMENT_KIND_LABELS: Record<PlacementKind, string> = {
  lattice: "격자 반복",
  scatter_poisson: "포아송 산포",
  scatter_sateen: "새틴 산포",
  path_straight: "직선 경로",
  path_wave: "물결 경로",
  point_template: "포인트 템플릿",
};

export const PLACEMENT_KIND_DESCRIPTIONS: Record<PlacementKind, string> = {
  lattice: "행·열 수를 지정한 규칙적 반복",
  scatter_poisson: "최소 간격을 지키며 흩뿌리기",
  scatter_sateen: "새틴 규칙으로 어긋나게 배치",
  path_straight: "직선을 따라 일정 간격 배치",
  path_wave: "물결 곡선을 따라 배치",
  point_template: "미리 정해진 소수 점 배치",
};

export function placementKind(placement: Placement): PlacementKind {
  if (placement.type === "scatter") return `scatter_${placement.mode}`;
  if (placement.type === "path") return `path_${placement.kind}`;
  return placement.type;
}

export function defaultPlacement(kind: PlacementKind): Placement {
  switch (kind) {
    case "lattice":
      return {
        type: "lattice",
        columns: 4,
        rows: 4,
        drop: "none",
        fixed_rotation_deg: 0,
      };
    case "scatter_poisson":
      return {
        type: "scatter",
        mode: "poisson",
        count: 12,
        min_distance_ratio: 0.18,
        fixed_rotation_deg: 0,
      };
    case "scatter_sateen":
      return {
        type: "scatter",
        mode: "sateen",
        order: 5,
        step: 2,
        fixed_rotation_deg: 0,
      };
    case "path_straight":
      return {
        type: "path",
        kind: "straight",
        direction: "diagonal_up",
        spacing_ratio: 0.25,
        phase_ratio: 0,
        rotation: "follow_path",
        fixed_rotation_deg: 0,
      };
    case "path_wave":
      return {
        type: "path",
        kind: "wave",
        direction: "horizontal",
        spacing_ratio: 0.25,
        phase_ratio: 0,
        wavelength_ratio: 1,
        amplitude_ratio: 0.12,
        rotation: "follow_path",
        fixed_rotation_deg: 0,
      };
    case "point_template":
      return {
        type: "point_template",
        template: "quincunx_inset",
        fixed_rotation_deg: 0,
      };
  }
}

export function defaultStripeLayer(): StripeLayer {
  return {
    type: "stripe",
    direction: "vertical",
    period_ratio: 0.5,
    bands: [{ offset_ratio: 0, width_ratio: 0.25, color_index: 1 }],
  };
}

export function defaultMotifLayer(motifIndex: number): MotifLayer {
  return {
    type: "motif",
    motif_index: motifIndex,
    size_ratio: 0.18,
    placement: defaultPlacement("lattice"),
  };
}

export const EMPTY_PLAN: DesignPlan = {
  colors: ["#F4EFE6", "#213547"], // harness-ignore -- DesignPlanV3 데이터, UI 스타일이 아님
  ground_color_index: 0,
  motifs: [],
  layers: [defaultStripeLayer()],
};

/** 서버 normalize_hex와 같은 규칙 — #RGB/RRGGBB(#생략 허용) → #RRGGBB 대문자 */
export function normalizeHex(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  let digits = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (/^[0-9A-F]{3}$/.test(digits)) {
    digits = Array.from(digits, (digit) => `${digit}${digit}`).join("");
  }
  if (!/^[0-9A-F]{6}$/.test(digits)) return null;
  return `#${digits}`;
}

/** motifs는 고른 모티프 개수에서 파생한다 — input_index는 모티프 피커 순서 */
export function motifSources(motifCount: number): PlanMotifSource[] {
  return Array.from({ length: motifCount }, (_, index) => ({
    source: "input" as const,
    input_index: index + 1,
  }));
}

export function stripeLayers(plan: DesignPlan): StripeLayer[] {
  return plan.layers.filter(
    (layer): layer is StripeLayer => layer.type === "stripe",
  );
}

/** 모티프 선택이 줄었을 때 사라진 슬롯을 참조하는 레이어를 걷어내고 인덱스를 다시 촘촘하게 만든다.
   그대로 두면 motif_index가 범위를 벗어나 레이어를 지우는 외에는 고칠 방법이 없다. */
export function realignMotifIndexes(
  layers: PlanLayer[],
  motifCount: number,
): PlanLayer[] {
  return layers.filter(
    (layer) => layer.type === "stripe" || layer.motif_index < motifCount,
  );
}

/** 고른 모티프 중 어느 레이어도 쓰지 않는 슬롯 번호(1-based) */
export function unusedMotifSlots(
  layers: PlanLayer[],
  motifCount: number,
): number[] {
  const used = new Set(
    layers.flatMap((layer) =>
      layer.type === "motif" ? [layer.motif_index] : [],
    ),
  );
  return Array.from({ length: motifCount }, (_, index) => index).flatMap(
    (index) => (used.has(index) ? [] : [index + 1]),
  );
}

/** 모티프 선택이 바뀐 뒤의 레이어 목록 — 사라진 슬롯을 참조하는 레이어는 걷어내고,
   새로 고른 슬롯에는 기본 격자 레이어를 붙인다. 고른 모티프를 쓰는 레이어가 없으면 Plan이
   유효하지 않아 프리뷰가 사라지므로, 고르는 즉시 타일에 보이게 하는 쪽이 맞다. */
export function syncMotifLayers(
  layers: PlanLayer[],
  motifCount: number,
): PlanLayer[] {
  const kept = realignMotifIndexes(layers, motifCount);
  const room = Math.max(0, MAX_LAYERS - kept.length);
  return [
    ...kept,
    ...unusedMotifSlots(kept, motifCount)
      .slice(0, room)
      .map((slot) => defaultMotifLayer(slot - 1)),
  ];
}

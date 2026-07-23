export const DEFAULT_CANDIDATE_COUNT = 4;

export type ReferenceImagePurpose =
  | "auto"
  | "color_mood"
  | "motif"
  | "composition";

export const REFERENCE_IMAGE_PURPOSES: ReadonlyArray<{
  value: ReferenceImagePurpose;
  label: string;
}> = [
  { value: "auto", label: "자동 판단" },
  { value: "color_mood", label: "색감·분위기 참고" },
  { value: "motif", label: "모티프 형태 참고" },
  { value: "composition", label: "배치·구도 참고" },
];

export function referenceImagePurposeLabel(purpose: ReferenceImagePurpose) {
  return (
    REFERENCE_IMAGE_PURPOSES.find((option) => option.value === purpose)
      ?.label ?? "자동 판단"
  );
}

export type DesignReferenceImage = {
  uploadId: string;
  purpose: ReferenceImagePurpose;
};

export type DesignPalette =
  | { mode: "auto"; colors: [] }
  | { mode: "fixed"; colors: string[] };

export const AUTO_DESIGN_PALETTE: DesignPalette = {
  mode: "auto",
  colors: [],
};

export type MotifScale = "auto" | "small" | "medium" | "large";
export type PatternDensity = "auto" | "sparse" | "medium" | "dense";
export type PatternArrangement = "auto" | "lattice" | "staggered" | "scatter";
export type PatternDirection = "auto" | "vertical" | "horizontal" | "diagonal";

export type DesignPatternConstraints = {
  motifScale: MotifScale;
  density: PatternDensity;
  arrangement: PatternArrangement;
  direction: PatternDirection;
};

export const AUTO_PATTERN_CONSTRAINTS: DesignPatternConstraints = {
  motifScale: "auto",
  density: "auto",
  arrangement: "auto",
  direction: "auto",
};

export function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  let digits = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (/^[0-9A-F]{3}$/.test(digits)) {
    digits = Array.from(digits, (digit) => `${digit}${digit}`).join("");
  }
  if (!/^[0-9A-F]{6}$/.test(digits)) return null;
  return `#${digits}`;
}

export function normalizePaletteColors(values: readonly string[]) {
  return Array.from(
    new Set(
      values
        .map(normalizeHexColor)
        .filter((value): value is string => value !== null),
    ),
  );
}

const SCALE_LABELS: Record<MotifScale, string> = {
  auto: "크기 자동",
  small: "작게",
  medium: "보통 크기",
  large: "크게",
};
const DENSITY_LABELS: Record<PatternDensity, string> = {
  auto: "밀도 자동",
  sparse: "여유롭게",
  medium: "보통 밀도",
  dense: "촘촘하게",
};
const ARRANGEMENT_LABELS: Record<PatternArrangement, string> = {
  auto: "배열 자동",
  lattice: "격자",
  staggered: "엇갈림",
  scatter: "흩뿌림",
};
const DIRECTION_LABELS: Record<PatternDirection, string> = {
  auto: "방향 자동",
  vertical: "수직",
  horizontal: "수평",
  diagonal: "대각선",
};

export function patternConstraintLabels(value: DesignPatternConstraints) {
  return [
    value.motifScale === "auto" ? null : SCALE_LABELS[value.motifScale],
    value.density === "auto" ? null : DENSITY_LABELS[value.density],
    value.arrangement === "auto" ? null : ARRANGEMENT_LABELS[value.arrangement],
    value.direction === "auto" ? null : DIRECTION_LABELS[value.direction],
  ].filter((label): label is string => label !== null);
}

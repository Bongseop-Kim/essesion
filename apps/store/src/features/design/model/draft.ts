export type ReferenceImagePurpose =
  | "auto"
  | "color_mood"
  | "motif"
  | "composition";

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

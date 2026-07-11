import type {
  ReferenceImageIn,
  SampleOrderCreateRequest,
} from "@essesion/api-client";

export type SampleOrderOptions = {
  sampleType: "fabric" | "sewing" | "fabric_and_sewing";
  fabricType: "POLY" | "SILK";
  designType: "PRINTING" | "YARN_DYED";
  tieType: "MANUAL" | "AUTO";
  interlining: "POLY" | "WOOL";
  additionalNotes: string;
};

export type SampleOrderDraft = {
  options: SampleOrderOptions;
  imageRefs: ReferenceImageIn[];
  totalCost: number;
};

export const DEFAULT_SAMPLE_ORDER_OPTIONS: SampleOrderOptions = {
  sampleType: "fabric",
  fabricType: "POLY",
  designType: "PRINTING",
  tieType: "AUTO",
  interlining: "WOOL",
  additionalNotes: "",
};

export function sampleOrderApiOptions(options: SampleOrderOptions) {
  const hasFabric = options.sampleType !== "sewing";
  return {
    fabric_type: hasFabric ? options.fabricType : null,
    design_type: hasFabric ? options.designType : null,
    tie_type: options.tieType === "AUTO" ? "AUTO" : null,
    interlining: options.interlining,
  } satisfies SampleOrderCreateRequest["options"];
}

export function sampleTypeLabel(value: SampleOrderOptions["sampleType"]) {
  return {
    fabric: "원단 샘플",
    sewing: "봉제 샘플",
    fabric_and_sewing: "원단 + 봉제 샘플",
  }[value];
}

export function sampleFabricLabel(options: SampleOrderOptions) {
  if (options.sampleType === "sewing") return "봉제 전용";
  return `${options.fabricType === "SILK" ? "실크" : "폴리"} · ${
    options.designType === "YARN_DYED" ? "선염" : "날염"
  }`;
}

export function readSampleOrderDraft(state: unknown): SampleOrderDraft | null {
  if (!state || typeof state !== "object" || !("sampleOrder" in state))
    return null;
  const draft = (state as { sampleOrder?: unknown }).sampleOrder;
  if (!draft || typeof draft !== "object") return null;

  const candidate = draft as Record<string, unknown>;
  if (!isSampleOrderOptions(candidate.options)) return null;
  if (
    !Array.isArray(candidate.imageRefs) ||
    !candidate.imageRefs.every(
      (image) =>
        image != null &&
        typeof image === "object" &&
        "object_key" in image &&
        typeof image.object_key === "string",
    )
  )
    return null;
  if (
    typeof candidate.totalCost !== "number" ||
    !Number.isFinite(candidate.totalCost) ||
    candidate.totalCost <= 0
  )
    return null;

  return candidate as SampleOrderDraft;
}

function isSampleOrderOptions(value: unknown): value is SampleOrderOptions {
  if (!value || typeof value !== "object") return false;
  const options = value as Record<string, unknown>;
  return (
    (options.sampleType === "fabric" ||
      options.sampleType === "sewing" ||
      options.sampleType === "fabric_and_sewing") &&
    (options.fabricType === "POLY" || options.fabricType === "SILK") &&
    (options.designType === "PRINTING" || options.designType === "YARN_DYED") &&
    (options.tieType === "MANUAL" || options.tieType === "AUTO") &&
    (options.interlining === "POLY" || options.interlining === "WOOL") &&
    typeof options.additionalNotes === "string"
  );
}

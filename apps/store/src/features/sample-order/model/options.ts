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

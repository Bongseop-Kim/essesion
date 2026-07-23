import type {
  OrderReferenceImageIn,
  SampleOrderCreateRequest,
} from "@essesion/api-client";
import { z } from "zod";

import { hasStateKey } from "@/shared/lib/guards";

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
  imageRefs: OrderReferenceImageIn[];
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

const sampleOrderDraftSchema = z.object({
  options: z.object({
    sampleType: z.enum(["fabric", "sewing", "fabric_and_sewing"]),
    fabricType: z.enum(["POLY", "SILK"]),
    designType: z.enum(["PRINTING", "YARN_DYED"]),
    tieType: z.enum(["MANUAL", "AUTO"]),
    interlining: z.enum(["POLY", "WOOL"]),
    additionalNotes: z.string(),
  }),
  imageRefs: z.array(
    z.object({
      upload_id: z
        .string()
        .regex(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        ),
    }),
  ),
  totalCost: z.number().refine((n) => Number.isFinite(n) && n > 0),
});

export function readSampleOrderDraft(state: unknown): SampleOrderDraft | null {
  if (!hasStateKey(state, "sampleOrder")) return null;
  const result = sampleOrderDraftSchema.safeParse(state.sampleOrder);
  return result.success ? result.data : null;
}

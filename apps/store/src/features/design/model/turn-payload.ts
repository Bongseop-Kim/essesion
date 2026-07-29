import { z } from "zod";

const paletteSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("auto"), colors: z.array(z.string()).max(0) }),
  z.object({
    mode: z.literal("fixed"),
    colors: z.array(z.string()).min(2).max(5),
  }),
]);

const patternConstraintsSchema = z.object({
  motif_scale: z.enum(["auto", "small", "medium", "large"]),
  density: z.enum(["auto", "sparse", "medium", "dense"]),
  arrangement: z.enum(["auto", "lattice", "staggered", "scatter"]),
  direction: z.enum(["auto", "vertical", "horizontal", "diagonal"]),
});

const candidateSchema = z
  .object({
    id: z.string().min(1),
    design_index: z.number().int().nonnegative(),
    seed: z.number().int(),
    colorway_id: z.string().min(1),
    svg: z.string().min(1),
  })
  .passthrough();

const generateRequestPayloadSchema = z
  .object({
    type: z.literal("generate_request"),
    mode: z.enum(["prompt", "variation"]),
    prompt: z.string().nullable(),
    seed: z.number().int().nullable(),
    colorway: z.string().nullable(),
    candidate_count: z.number().int().min(1).max(4),
    palette: paletteSchema.optional(),
    pattern_constraints: patternConstraintsSchema.optional(),
  })
  .passthrough();

const generatePayloadSchema = z
  .object({
    type: z.literal("generate"),
    response: z
      .object({
        run_id: z.string().uuid(),
        candidates: z.array(candidateSchema),
        warnings: z.array(z.string()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

const generateErrorPayloadSchema = z
  .object({
    type: z.literal("generate_error"),
    run_id: z.string().uuid(),
    status: z.literal("error"),
    error: z.object({
      stage: z.string().min(1),
      code: z.string().min(1),
    }),
  })
  .passthrough();

const selectPayloadSchema = z
  .object({
    type: z.literal("select"),
    run_id: z.string().uuid(),
    candidate_id: z.string().min(1),
    design_index: z.number().int().nonnegative(),
    seed: z.number().int(),
    colorway_id: z.string().min(1),
  })
  .passthrough();

const finalizePayloadSchema = z
  .object({
    type: z.literal("finalize"),
    job_id: z.string().uuid(),
    production_method: z.string().min(1),
    weave: z.string().min(1),
  })
  .passthrough();

const designTurnPayloadSchema = z.discriminatedUnion("type", [
  generateRequestPayloadSchema,
  generatePayloadSchema,
  generateErrorPayloadSchema,
  selectPayloadSchema,
  finalizePayloadSchema,
]);

export type DesignTurnPayload = z.infer<typeof designTurnPayloadSchema>;

export function parseDesignTurnPayload(
  value: unknown,
): DesignTurnPayload | null {
  const parsed = designTurnPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function latestSubmittedCandidateCount(
  turns: ReadonlyArray<{ payload: unknown }>,
  fallback: number,
): number {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const payload = parseDesignTurnPayload(turns[index]?.payload);
    if (payload?.type === "generate_request") {
      return payload.candidate_count;
    }
  }
  return fallback;
}

import { z } from "zod";

const intentSchema = z.record(z.string(), z.unknown());

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
    candidate_count: z.number().int().positive(),
    palette: paletteSchema.optional(),
    pattern_constraints: patternConstraintsSchema.optional(),
  })
  .passthrough();

const generatePayloadSchema = z
  .object({
    type: z.literal("generate"),
    response: z
      .object({
        candidates: z.array(candidateSchema),
        intents: z.array(intentSchema),
        warnings: z.array(z.string()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

const selectPayloadSchema = z
  .object({
    type: z.literal("select"),
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

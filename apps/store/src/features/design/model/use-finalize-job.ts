import {
  appendDesignTurn,
  createFinalizeJob,
  type DesignTurnOut,
  type FinalizeRequest,
  type GenerationJobOut,
} from "@essesion/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  designSessionQueryKey,
  designSessionsQueryKey,
  designTurnsQueryKey,
  generationJobQueryKey,
  generationJobQueryOptions,
  generationJobsQueryKey,
} from "./queries";

export const FINALIZE_JOB_POLL_INTERVAL_MS = 2_500;
export const FINALIZE_JOB_POLL_TIMEOUT_MS = 5 * 60 * 1_000;

export function finalizeJobPollInterval(
  job: Pick<GenerationJobOut, "status" | "created_at"> | undefined,
  now = Date.now(),
): typeof FINALIZE_JOB_POLL_INTERVAL_MS | false {
  if (!job || (job.status !== "queued" && job.status !== "processing")) {
    return false;
  }
  const createdAt = Date.parse(job.created_at);
  if (
    !Number.isFinite(createdAt) ||
    now - createdAt >= FINALIZE_JOB_POLL_TIMEOUT_MS
  ) {
    return false;
  }
  return FINALIZE_JOB_POLL_INTERVAL_MS;
}

export type CreateFinalizeJobInput = {
  sessionId: string;
  request: FinalizeRequest & {
    production_method: string;
    weave: string;
  };
};

export type CreateFinalizeJobResult = {
  job: GenerationJobOut;
  turn: DesignTurnOut | null;
  turnAppendError: unknown | null;
};

export function finalizeRetryInput(
  job: GenerationJobOut,
): CreateFinalizeJobInput | null {
  const { params } = job;
  if (
    job.kind !== "finalize" ||
    job.status !== "failed" ||
    !job.session_id ||
    !isRecord(params.intent) ||
    (typeof params.colorway_id !== "string" && params.colorway_id !== null) ||
    typeof params.production_method !== "string" ||
    params.production_method.length === 0 ||
    typeof params.weave !== "string" ||
    params.weave.length === 0 ||
    typeof params.dpi !== "number" ||
    !Number.isFinite(params.dpi)
  ) {
    return null;
  }

  const request: CreateFinalizeJobInput["request"] = {
    intent: params.intent,
    colorway_id: params.colorway_id,
    production_method: params.production_method,
    weave: params.weave,
    dpi: params.dpi,
  };

  if ("material_map" in params) {
    if (!isStringRecord(params.material_map)) return null;
    request.material_map = params.material_map;
  }
  for (const key of ["texture_strength", "relief_strength"] as const) {
    if (!(key in params)) continue;
    const value = params[key];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    request[key] = value;
  }

  return { sessionId: job.session_id, request };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

export function useCreateFinalizeJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: CreateFinalizeJobInput,
    ): Promise<CreateFinalizeJobResult> => {
      const { data: job } = await createFinalizeJob({
        path: { session_id: input.sessionId },
        body: input.request,
        throwOnError: true,
      });
      queryClient.setQueryData(generationJobQueryKey(job.id), job);

      let turn: DesignTurnOut | null = null;
      let turnAppendError: unknown | null = null;
      try {
        const response = await appendDesignTurn({
          path: { session_id: input.sessionId },
          body: {
            role: "user",
            payload: {
              type: "finalize",
              job_id: job.id,
              production_method: input.request.production_method,
              weave: input.request.weave,
            },
          },
          throwOnError: true,
        });
        turn = response.data;
      } catch (error) {
        turnAppendError = error;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: designSessionsQueryKey() }),
        queryClient.invalidateQueries({
          queryKey: designSessionQueryKey(input.sessionId),
        }),
        queryClient.invalidateQueries({
          queryKey: designTurnsQueryKey(input.sessionId),
        }),
        queryClient.invalidateQueries({ queryKey: generationJobsQueryKey() }),
      ]);

      return { job, turn, turnAppendError };
    },
  });
}

export function useFinalizeJobQuery(
  jobId: string | null,
  authenticated: boolean,
) {
  return useQuery({
    ...generationJobQueryOptions({ jobId, authenticated }),
    refetchInterval: (query) => finalizeJobPollInterval(query.state.data),
  });
}

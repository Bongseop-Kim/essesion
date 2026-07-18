import {
  appendDesignTurn,
  cancelGenerationJob,
  createFinalizeJob,
  type DesignTurnOut,
  type FinalizeRequest,
  type GenerationJobOut,
} from "@essesion/api-client";
import { listDesignSessionsQueryKey } from "@essesion/api-client/query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  designSessionQueryKey,
  designTurnsQueryKey,
  generationJobQueryKey,
  generationJobQueryOptions,
  generationJobsQueryKey,
} from "./queries";

export const FINALIZE_JOB_POLL_INTERVAL_MS = 2_500;
export const FINALIZE_JOB_POLL_TIMEOUT_MS = 5 * 60 * 1_000;
// 5분 이후엔 저빈도 폴링으로 전환 — 서버가 폴링 시점에 TTL(75분) 초과 작업을
// 자동 취소하므로, 탭을 열어둔 사용자는 배치를 기다리지 않고 종결을 본다.
export const FINALIZE_JOB_SLOW_POLL_INTERVAL_MS = 60_000;
export const FINALIZE_JOB_POLL_HARD_STOP_MS = 80 * 60 * 1_000;

export function finalizeJobDelayed(
  job: Pick<GenerationJobOut, "status" | "created_at"> | undefined,
  now = Date.now(),
): boolean {
  if (!job || (job.status !== "queued" && job.status !== "processing")) {
    return false;
  }
  const createdAt = Date.parse(job.created_at);
  return (
    !Number.isFinite(createdAt) ||
    now - createdAt >= FINALIZE_JOB_POLL_TIMEOUT_MS
  );
}

export function finalizeJobPollInterval(
  job: Pick<GenerationJobOut, "status" | "created_at"> | undefined,
  now = Date.now(),
): number | false {
  if (!job || (job.status !== "queued" && job.status !== "processing")) {
    return false;
  }
  const createdAt = Date.parse(job.created_at);
  if (!Number.isFinite(createdAt)) {
    return false;
  }
  const elapsed = now - createdAt;
  if (elapsed >= FINALIZE_JOB_POLL_HARD_STOP_MS) {
    return false;
  }
  if (elapsed >= FINALIZE_JOB_POLL_TIMEOUT_MS) {
    return FINALIZE_JOB_SLOW_POLL_INTERVAL_MS;
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
    (job.status !== "failed" && job.status !== "canceled") ||
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
        queryClient.invalidateQueries({
          queryKey: listDesignSessionsQueryKey(),
        }),
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

export function useCancelFinalizeJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string): Promise<GenerationJobOut> => {
      const { data: job } = await cancelGenerationJob({
        path: { job_id: jobId },
        throwOnError: true,
      });
      queryClient.setQueryData(generationJobQueryKey(job.id), job);

      const invalidations = [
        queryClient.invalidateQueries({ queryKey: generationJobsQueryKey() }),
      ];
      if (job.session_id) {
        // 취소는 finalize 예산을 되돌린다 — 세션의 finalize_used 갱신
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: designSessionQueryKey(job.session_id),
          }),
        );
      }
      await Promise.all(invalidations);
      return job;
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

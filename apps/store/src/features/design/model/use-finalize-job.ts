import {
  appendDesignTurn,
  createFinalizeJob,
  type DesignTurnOut,
  type FinalizeRequest,
  type GenerationJobOut,
} from "@essesion/api-client";
import {
  listDesignSessionsQueryKey,
  listGenerationJobsQueryKey,
} from "@essesion/api-client/query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  designSessionQueryKey,
  designTurnsQueryKey,
  generationJobQueryKey,
  generationJobQueryOptions,
} from "./queries";

export const FINALIZE_JOB_POLL_INTERVAL_MS = 2_500;
export const FINALIZE_JOB_POLL_TIMEOUT_MS = 5 * 60 * 1_000;
// 5분 이후엔 저빈도 폴링으로 전환 — 서버가 폴링 시점에 TTL(75분) 초과 작업을
// 자동 취소하므로, 탭을 열어둔 사용자는 배치를 기다리지 않고 종결을 본다.
export const FINALIZE_JOB_SLOW_POLL_INTERVAL_MS = 60_000;

export function finalizeJobPollInterval(
  job: Pick<GenerationJobOut, "status" | "created_at"> | undefined,
  now = Date.now(),
): number | false {
  if (!job || (job.status !== "queued" && job.status !== "processing")) {
    return false;
  }
  const createdAt = Date.parse(job.created_at);
  // 생성 시각을 못 읽으면 지연으로 취급 — 저빈도 폴링이 서버 lazy 취소로 수렴한다
  if (
    !Number.isFinite(createdAt) ||
    now - createdAt >= FINALIZE_JOB_POLL_TIMEOUT_MS
  ) {
    return FINALIZE_JOB_SLOW_POLL_INTERVAL_MS;
  }
  return FINALIZE_JOB_POLL_INTERVAL_MS;
}

export type CreateFinalizeJobInput = {
  sessionId: string;
  request: FinalizeRequest & { production_method: string; weave: string };
};

export type CreateFinalizeJobResult = {
  job: GenerationJobOut;
  turn: DesignTurnOut | null;
  turnAppendError: unknown | null;
};

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
        queryClient.invalidateQueries({
          queryKey: listGenerationJobsQueryKey(),
        }),
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

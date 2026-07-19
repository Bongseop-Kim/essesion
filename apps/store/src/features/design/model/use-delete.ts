import { deleteDesignSession, deleteGenerationJob } from "@essesion/api-client";
import { listDesignSessionsQueryKey } from "@essesion/api-client/query";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  designSessionQueryKey,
  designTurnsQueryKey,
  generationJobQueryKey,
  generationJobsQueryKey,
} from "./queries";

export function useDeleteDesignSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      await deleteDesignSession({
        path: { session_id: sessionId },
        throwOnError: true,
      });
      queryClient.removeQueries({ queryKey: designSessionQueryKey(sessionId) });
      queryClient.removeQueries({ queryKey: designTurnsQueryKey(sessionId) });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: listDesignSessionsQueryKey(),
        }),
        // 세션 삭제로 완성본의 session_id가 NULL로 바뀐다 — 목록 캐시 갱신
        queryClient.invalidateQueries({ queryKey: generationJobsQueryKey() }),
      ]);
    },
  });
}

export function useDeleteFinalizedJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string) => {
      await deleteGenerationJob({
        path: { job_id: jobId },
        throwOnError: true,
      });
      queryClient.removeQueries({ queryKey: generationJobQueryKey(jobId) });
      await queryClient.invalidateQueries({
        queryKey: generationJobsQueryKey(),
      });
    },
  });
}

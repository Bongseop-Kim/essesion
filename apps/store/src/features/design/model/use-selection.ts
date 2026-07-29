import {
  branchDesignSession,
  type DesignSessionOut,
  selectDesignCandidate,
} from "@essesion/api-client";
import { listDesignSessionsQueryKey } from "@essesion/api-client/query";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { designSessionQueryKey, designTurnsQueryKey } from "./queries";
import type { DesignCandidate } from "./selection";

export type SelectDesignInput = {
  sessionId: string;
  runId: string;
  candidate: DesignCandidate;
};

export type SelectDesignResult = {
  session: DesignSessionOut;
};

export function useDesignSelection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: SelectDesignInput,
    ): Promise<SelectDesignResult> => {
      const { data: session } = await selectDesignCandidate({
        path: { session_id: input.sessionId },
        body: {
          run_id: input.runId,
          candidate_id: input.candidate.id,
        },
        throwOnError: true,
      });

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
      ]);

      return { session };
    },
  });
}

export function useDesignBranch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SelectDesignInput): Promise<DesignSessionOut> => {
      const { data: session } = await branchDesignSession({
        path: { session_id: input.sessionId },
        body: {
          run_id: input.runId,
          candidate_id: input.candidate.id,
        },
        throwOnError: true,
      });
      await queryClient.invalidateQueries({
        queryKey: listDesignSessionsQueryKey(),
      });
      return session;
    },
  });
}

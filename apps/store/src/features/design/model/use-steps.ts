import { activateDesignStep, activateMotif } from "@essesion/api-client";
import { getTokenBalanceQueryKey } from "@essesion/api-client/query";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { designSessionQueryKey, designTurnsQueryKey } from "./queries";

/** 되돌리기 — 이력 썸네일 클릭이 편집 포인터를 그 스텝으로 옮긴다. 과금 없음. */
export function useActivateDesignStep() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { sessionId: string; runId: string }) => {
      const { data } = await activateDesignStep({
        path: { session_id: input.sessionId },
        body: { run_id: input.runId },
        throwOnError: true,
      });
      queryClient.setQueryData(designSessionQueryKey(input.sessionId), data);
      await queryClient.invalidateQueries({
        queryKey: designTurnsQueryKey(input.sessionId),
      });
      return data;
    },
  });
}

/** 모티프 슬롯 교체 — 모델 호출 없이 재렌더만 하므로 토큰이 들지 않는다. */
export function useActivateMotifSlot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      sessionId: string;
      slot: 1 | 2;
      motifId: string;
    }) => {
      const { data } = await activateMotif({
        path: { session_id: input.sessionId },
        body: { slot: input.slot, motif_id: input.motifId },
        throwOnError: true,
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: designSessionQueryKey(input.sessionId),
        }),
        queryClient.invalidateQueries({
          queryKey: designTurnsQueryKey(input.sessionId),
        }),
        queryClient.invalidateQueries({ queryKey: getTokenBalanceQueryKey() }),
      ]);
      return data;
    },
  });
}

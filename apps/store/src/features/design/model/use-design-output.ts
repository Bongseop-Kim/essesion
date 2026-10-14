import {
  createFinalizeJob,
  type FinalizeRequest,
  type GenerationJobOut,
} from "@essesion/api-client";
import {
  getTokenBalanceQueryKey,
  listDesignSessionsQueryKey,
  listGenerationJobsQueryKey,
} from "@essesion/api-client/query";
import { snackbar } from "@essesion/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { designErrorMessage } from "./errors";
import { designSessionQueryKey } from "./queries";

export type FinalizeDialogValue = {
  productionMethod: NonNullable<FinalizeRequest["production_method"]>;
  weave: NonNullable<FinalizeRequest["weave"]>;
  dpi: 300;
};

export type CreateFinalizeJobInput = {
  sessionId: string;
  request: FinalizeRequest & { production_method: string; weave: string };
};

/** 실사화 생성 — 동기 요청-응답. 성공 시 세션·완성본 목록 캐시를 갱신한다. */
function useCreateFinalizeJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateFinalizeJobInput) => {
      const { data: job } = await createFinalizeJob({
        path: { session_id: input.sessionId },
        body: input.request,
        throwOnError: true,
      });

      return job;
    },
    onSuccess: (_job, input) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: listDesignSessionsQueryKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: designSessionQueryKey(input.sessionId),
        }),
        queryClient.invalidateQueries({
          queryKey: listGenerationJobsQueryKey(),
        }),
      ]),
    // 차감(성공)이든 환불(실패)이든 잔액이 움직였다 — 같은 화면의 pill을 맞춘다.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: getTokenBalanceQueryKey() }),
  });
}

/** 실사화 — generate와 같은 동기 경로. 응답이 곧 완성본이라 폴링이 없다. */
export function useFinalizeFlow(options: {
  sessionId: string | null;
  onDone: (job: GenerationJobOut) => void;
}) {
  const mutation = useCreateFinalizeJob();

  const submit = async (value: FinalizeDialogValue) => {
    const sessionId = options.sessionId;
    if (!sessionId || mutation.isPending) return;
    try {
      const job = await mutation.mutateAsync({
        sessionId,
        request: {
          production_method: value.productionMethod,
          weave: value.weave,
          dpi: value.dpi,
        },
      });
      options.onDone(job);
      snackbar("실사화를 완성했어요. 완성본에서 확인할 수 있어요.");
    } catch (error) {
      snackbar(designErrorMessage(error, "실사화하지 못했습니다."));
    }
  };

  return {
    loading: mutation.isPending,
    submit: (value: FinalizeDialogValue) => void submit(value),
  };
}

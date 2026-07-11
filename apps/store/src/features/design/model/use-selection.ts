import {
  appendDesignTurn,
  type DesignGenerateOut,
  type DesignSessionOut,
  type DesignTurnOut,
  updateDesignSession,
} from "@essesion/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  designSessionQueryKey,
  designSessionsQueryKey,
  designTurnsQueryKey,
} from "./queries";
import { type DesignCandidate, selectionForCandidate } from "./selection";

export type SelectDesignInput = {
  sessionId: string;
  candidate: DesignCandidate;
  intents: DesignGenerateOut["intents"];
};

export type SelectDesignResult = {
  session: DesignSessionOut;
  turn: DesignTurnOut | null;
  turnAppendError: unknown | null;
};

export function useDesignSelection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: SelectDesignInput,
    ): Promise<SelectDesignResult> => {
      const selection = selectionForCandidate(input.candidate, input.intents);
      if (!selection?.intent) {
        throw new Error("선택한 후보의 intent를 찾을 수 없습니다.");
      }

      const { data: session } = await updateDesignSession({
        path: { session_id: input.sessionId },
        body: {
          current_intent: selection.intent,
          seed: input.candidate.seed,
          colorway: input.candidate.colorway_id,
        },
        throwOnError: true,
      });

      let turn: DesignTurnOut | null = null;
      let turnAppendError: unknown | null = null;
      try {
        const response = await appendDesignTurn({
          path: { session_id: input.sessionId },
          body: {
            role: "user",
            payload: {
              type: "select",
              candidate_id: input.candidate.id,
              design_index: input.candidate.design_index,
              seed: input.candidate.seed,
              colorway_id: input.candidate.colorway_id,
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
      ]);

      return { session, turn, turnAppendError };
    },
  });
}

import {
  createDesignSession,
  type DesignGenerateOut,
  generateDesign,
} from "@essesion/api-client";
import {
  getTokenBalanceQueryKey,
  listDesignSessionsQueryKey,
} from "@essesion/api-client/query";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  clearPendingDesign,
  type StorageLike,
  writePendingDesign,
} from "./pending";
import { designSessionQueryKey, designTurnsQueryKey } from "./queries";

type GenerateBase = {
  candidateCount?: number;
  colorway?: string | null;
};

export type GenerateDesignInput =
  | (GenerateBase & {
      mode: "prompt";
      sessionId?: string | null;
      prompt: string;
    })
  | (GenerateBase & {
      mode: "variation";
      sessionId: string;
      intent: Record<string, unknown>;
      seed: number;
    });

export type GenerateDesignResult = {
  sessionId: string;
  response: DesignGenerateOut;
};

export class StaleDesignOperationError extends Error {
  override name = "StaleDesignOperationError";

  constructor() {
    super("stale design operation");
  }
}

let pendingOperationSequence = 0;

function createPendingOperationId() {
  pendingOperationSequence += 1;
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${pendingOperationSequence.toString(36)}`
  );
}

export function useGenerateDesign(options?: {
  pendingStorage?: StorageLike | null;
  onSessionReady?: (sessionId: string, input: GenerateDesignInput) => boolean;
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: GenerateDesignInput,
    ): Promise<GenerateDesignResult> => {
      let sessionId = input.sessionId ?? null;
      if (!sessionId) {
        const { data: session } = await createDesignSession({
          throwOnError: true,
        });
        sessionId = session.id;
      }

      const accepted = options?.onSessionReady?.(sessionId, input) ?? true;
      if (!accepted) throw new StaleDesignOperationError();
      const operationId = createPendingOperationId();
      writePendingDesign(sessionId, {
        storage: options?.pendingStorage,
        operationId,
      });
      try {
        const { data: response } = await generateDesign({
          body:
            input.mode === "prompt"
              ? {
                  session_id: sessionId,
                  prompt: input.prompt,
                  candidate_count: input.candidateCount ?? 4,
                  colorway: input.colorway,
                }
              : {
                  session_id: sessionId,
                  intent: input.intent,
                  seed: input.seed,
                  candidate_count: input.candidateCount ?? 4,
                  colorway: input.colorway,
                },
          throwOnError: true,
        });
        return { sessionId, response };
      } finally {
        clearPendingDesign({
          storage: options?.pendingStorage,
          operationId,
        });
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: listDesignSessionsQueryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: designSessionQueryKey(sessionId),
          }),
          queryClient.invalidateQueries({
            queryKey: designTurnsQueryKey(sessionId),
          }),
          queryClient.invalidateQueries({
            queryKey: getTokenBalanceQueryKey(),
          }),
        ]);
      }
    },
  });
}

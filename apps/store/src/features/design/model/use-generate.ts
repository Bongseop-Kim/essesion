import {
  createDesignSession,
  type DesignGenerateOut,
  generateDesign,
  rerollDesign,
} from "@essesion/api-client";
import {
  getTokenBalanceQueryKey,
  listDesignSessionsQueryKey,
} from "@essesion/api-client/query";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { trackEvent } from "@/shared/lib/analytics";

import type {
  DesignPalette,
  DesignPatternConstraints,
  DesignReferenceImage,
} from "./draft";

import {
  clearPendingDesign,
  type StorageLike,
  writePendingDesign,
} from "./pending";
import { designSessionQueryKey, designTurnsQueryKey } from "./queries";

type GenerateBase = {
  candidateCount?: number;
  colorway?: string | null;
  referenceImages?: DesignReferenceImage[];
  userMotifIds?: string[];
  palette?: DesignPalette;
  patternConstraints?: DesignPatternConstraints;
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
        const sharedConstraints = {
          candidate_count: input.candidateCount ?? 4,
          // A fixed palette deterministically collapses the worker colorway axis to
          // `default`; carrying a previous session colorway would be contradictory.
          colorway:
            input.palette?.mode === "fixed" ? undefined : input.colorway,
          palette: input.palette,
        };
        const { data: response } =
          input.mode === "prompt"
            ? await generateDesign({
                body: {
                  session_id: sessionId,
                  prompt: input.prompt,
                  ...sharedConstraints,
                  reference_images: (input.referenceImages ?? []).map(
                    (image) => ({
                      upload_id: image.uploadId,
                      purpose: image.purpose,
                    }),
                  ),
                  user_motif_ids: input.userMotifIds ?? [],
                },
                throwOnError: true,
              })
            : await rerollDesign({
                path: { session_id: sessionId },
                body: {
                  seed: input.seed,
                  ...sharedConstraints,
                },
                throwOnError: true,
              });
        // prompt 원문·sessionId는 넣지 않는다
        trackEvent("generate_design", { mode: input.mode });
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

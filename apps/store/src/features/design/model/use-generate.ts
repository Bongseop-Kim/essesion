import {
  createDesignSession,
  type DesignGenerateOut,
  type DesignOut,
  type DesignWarningOut,
  generateDesign,
} from "@essesion/api-client";
import {
  getTokenBalanceQueryKey,
  listDesignSessionsQueryKey,
} from "@essesion/api-client/query";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { trackEvent } from "@/shared/lib/analytics";

import type { DesignPalette, DesignReferenceImage } from "./draft";

import {
  clearPendingDesign,
  type StorageLike,
  writePendingDesign,
} from "./pending";
import { designSessionQueryKey, designTurnsQueryKey } from "./queries";

export type GenerateDesignInput = {
  sessionId?: string | null;
  prompt: string;
  /** 첫 생성에만 보낼 수 있다 — 커밋된 디자인이 있으면 서버가 422로 막는다. */
  referenceImages?: DesignReferenceImage[];
  userMotifIds?: string[];
  palette?: DesignPalette;
};

export type GenerateDesignResult = {
  sessionId: string;
  /** 범위 밖 지시 — 토큰·이력·문맥이 요청 전과 같다. */
  rejected: boolean;
  design: DesignOut | null;
  /**
   * 자동 조정 안내(코드 + 한글 한 줄). 턴 이력의 `response.warnings`는 엔진 영문
   * 진단이라 쓸 수 없다 — 고객 문구는 이 응답에만 있다.
   */
  warnings: readonly DesignWarningOut[];
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
  onSessionReady?: (sessionId: string) => boolean;
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

      const accepted = options?.onSessionReady?.(sessionId) ?? true;
      if (!accepted) throw new StaleDesignOperationError();
      const operationId = createPendingOperationId();
      writePendingDesign(sessionId, {
        storage: options?.pendingStorage,
        operationId,
      });
      try {
        const { data: response } = await generateDesign({
          body: {
            session_id: sessionId,
            prompt: input.prompt,
            palette: input.palette,
            reference_images: (input.referenceImages ?? []).map((image) => ({
              upload_id: image.uploadId,
              purpose: image.purpose,
            })),
            user_motif_ids: input.userMotifIds ?? [],
          },
          throwOnError: true,
        });
        // prompt 원문·sessionId는 넣지 않는다
        trackEvent("generate_design", {
          rejected: "rejected" in response ? ("1" as const) : ("0" as const),
        });
        const out =
          response && !("rejected" in response)
            ? (response as DesignGenerateOut)
            : null;
        return {
          sessionId,
          rejected: out === null,
          design: out?.design ?? null,
          warnings: out?.warnings ?? [],
        };
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

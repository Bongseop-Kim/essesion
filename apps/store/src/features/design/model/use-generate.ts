import {
  createDesignSession,
  type DesignGenerateOut,
  type DesignGenerateRejectedOut,
  type DesignOut,
  type DesignWarningOut,
  generateDesign,
  type MotifIntentOut,
} from "@essesion/api-client";
import {
  getTokenBalanceQueryKey,
  listDesignSessionsQueryKey,
} from "@essesion/api-client/query";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { trackEvent } from "@/shared/lib/analytics";

import { isServerRejection } from "./errors";
import {
  clearPendingDesign,
  type StorageLike,
  writePendingDesign,
} from "./pending";
import { designSessionQueryKey, designTurnsQueryKey } from "./queries";

export type GenerateDesignInput = {
  sessionId?: string | null;
  prompt: string;
  userMotifIds?: string[];
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
  /** 모티프 피커로 넘기고 버리는 현재 응답의 힌트. */
  motifIntent: MotifIntentOut | null;
  /** 거절 사유 코드 — 피커 힌트가 없을 때 상단 알림 문구를 고르는 데 쓴다. */
  rejectedReason: DesignGenerateRejectedOut["reason"] | null;
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
      // 서버가 결과를 내놨는지 — 통신이 끊긴 경우에만 pending 표시를 남긴다.
      let settled = false;
      try {
        const { data: response } = await generateDesign({
          body: {
            session_id: sessionId,
            prompt: input.prompt,
            user_motif_ids: input.userMotifIds ?? [],
          },
          throwOnError: true,
        });
        const rejected =
          typeof response === "object" &&
          response !== null &&
          "rejected" in response;
        // prompt 원문·sessionId는 넣지 않는다
        trackEvent("generate_design", {
          rejected: rejected ? ("1" as const) : ("0" as const),
        });
        const out =
          response && !rejected ? (response as DesignGenerateOut) : null;
        settled = true;
        return {
          sessionId,
          rejected,
          design: out?.design ?? null,
          warnings: out?.warnings ?? [],
          // 성공·거절 응답이 같은 이름으로 싣는다.
          motifIntent:
            (response as DesignGenerateRejectedOut | undefined)?.motif_intent ??
            null,
          rejectedReason:
            (response as DesignGenerateRejectedOut | undefined)?.reason ?? null,
        };
      } catch (error) {
        // 서버가 응답한 실패는 결과가 없음이 확정이다. fetch가 끊긴 실패는 서버가
        // 완료했을 수 있으므로 표시를 남겨 세션 복구 조회가 잇는다.
        settled = isServerRejection(error);
        throw error;
      } finally {
        if (settled) {
          clearPendingDesign({
            storage: options?.pendingStorage,
            operationId,
          });
        }
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

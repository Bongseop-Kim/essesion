import type { MotifIntentOut } from "@essesion/api-client";
import { useRef, useState } from "react";

import { type DesignErrorFeedback, parseDesignError } from "./errors";
import { createOperationEpoch } from "./operation-epoch";
import {
  type GenerateDesignInput,
  StaleDesignOperationError,
  useGenerateDesign,
} from "./use-generate";

export type PromptGenerationOptions = {
  sessionId: string | null;
  ensureAuth: () => boolean;
  onSessionChange: (sessionId: string) => void;
  /** 되돌리기·모티프 교체처럼 같은 세션을 만지는 다른 요청이 진행 중인지 */
  blocked: boolean;
  /** 피커 안내 sidecar — `rejected` 알림을 대신하므로 필수다. */
  onMotifIntent: (intent: MotifIntentOut) => void;
};

/**
 * 입력창 문장 하나로 디자인을 만들거나 고치는 흐름 전체 —
 * 초안 문장, 생성 요청, 경쟁 가드, 거절·오류 상태를 함께 소유한다.
 */
export function usePromptGeneration({
  sessionId,
  ensureAuth,
  onSessionChange,
  blocked,
  onMotifIntent,
}: PromptGenerationOptions) {
  const [prompt, setPrompt] = useState("");
  const [selectSignal, setSelectSignal] = useState(0);
  const epoch = useRef(createOperationEpoch()).current;
  // pending 가드로 제출은 한 번에 하나 — 진행 중인 요청의 epoch만 담는다.
  const operation = useRef(0);
  // state 기반 pending은 같은 tick의 중복 호출을 못 막는다 — ref로 즉시 잠근다.
  const inFlight = useRef(false);

  const mutation = useGenerateDesign({
    onSessionReady: (readySessionId) => {
      if (!epoch.isCurrent(operation.current)) return false;
      onSessionChange(readySessionId);
      return true;
    },
  });

  const clearDraft = () => setPrompt("");

  /** 세션을 바꿀 때 — 진행 중이던 요청의 결과가 새 세션에 반영되지 않게 한다. */
  const reset = () => {
    epoch.invalidate();
    mutation.reset();
    clearDraft();
  };

  const pending = mutation.isPending || blocked;

  const submit = async () => {
    if (inFlight.current || !prompt.trim() || !ensureAuth() || pending) return;
    inFlight.current = true;
    mutation.reset();
    try {
      const input: GenerateDesignInput = {
        sessionId,
        prompt: prompt.trim(),
      };
      operation.current = epoch.begin();
      const current = operation.current;
      const result = await mutation.mutateAsync(input);
      if (!epoch.isCurrent(current)) return;
      onSessionChange(result.sessionId);
      if (result.motifIntent) onMotifIntent(result.motifIntent);
      // 거절은 문장을 남기고 전체 선택만 한다 — 무엇이 거절됐는지 보이면서 다음 입력이 덮어쓴다.
      if (result.rejected) setSelectSignal((signal) => signal + 1);
      else clearDraft();
    } catch {
      // 상단 알림이 mutation.error를 안내한다. 문장은 남아 전송이 곧 재시도다.
    } finally {
      inFlight.current = false;
    }
  };

  const error: DesignErrorFeedback | null =
    mutation.error && !(mutation.error instanceof StaleDesignOperationError)
      ? parseDesignError(mutation.error)
      : null;

  return {
    prompt,
    selectSignal,
    pending,
    generating: mutation.isPending,
    /** 거절됐고 피커 안내 시그널도 없었다 — 이때만 상단 알림으로 알린다. */
    rejected: mutation.data?.rejected === true && !mutation.data.motifIntent,
    /** 방금 적용한 편집의 자동 조정 안내 — 다음 문장을 쓰면 사라진다. */
    warnings: mutation.data?.warnings ?? [],
    error,
    reset,
    submit: () => void submit(),
    /** 문장을 고치면 이전 요청의 알림은 사라진다. */
    changePrompt(value: string) {
      setPrompt(value);
      if (mutation.data || mutation.error) mutation.reset();
    },
  };
}

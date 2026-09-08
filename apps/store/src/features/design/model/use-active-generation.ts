import type { DesignSessionOut } from "@essesion/api-client";
import {
  getTokenBalanceQueryKey,
  listDesignSessionsQueryKey,
} from "@essesion/api-client/query";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { clearPendingDesign } from "./pending";
import {
  ACTIVE_GENERATION_WAIT_LIMIT_MS,
  designTurnsQueryKey,
} from "./queries";

export type ActiveGenerationState = {
  /** 서버가 생성 중이고 아직 대기 상한 안이다 — 편집·교체·되돌리기를 잠근다. */
  recovering: boolean;
  /** 상한을 넘겼다 — 기다리기를 멈추고 재확인 안내로 넘긴다. */
  expired: boolean;
};

/**
 * 진행 중 생성의 서버 상태 복원.
 *
 * 새로고침으로 원래 mutation을 잃어도 세션 단건 응답의 `active_generation_id`가 진행
 * 여부의 정본이고(재조회 간격은 `queries.ts`), 종료가 관찰되면 이력·잔액·목록을 당겨온다.
 * 시간 경과만으로 성공·환불을 단정하지 않는다 — 상한 이후에도 상태는 서버만 정한다.
 */
export function useActiveGeneration({
  sessionId,
  session,
  onSettled,
}: {
  sessionId: string | null;
  session: DesignSessionOut | undefined;
  /** 서버가 진행 중이 아니라고 답했다 — 페이지의 복구 표시를 지운다. */
  onSettled: () => void;
}): ActiveGenerationState {
  const queryClient = useQueryClient();
  const activeId = session?.active_generation_id ?? null;
  const startedAt = session?.active_generation_started_at ?? null;
  const loaded = !!session;
  const [expired, setExpired] = useState(false);
  const settle = useRef(onSettled);
  settle.current = onSettled;
  /** 이 세션에서 마지막으로 본 상태 — `"idle"`은 종료를 이미 처리했다는 뜻. */
  const observed = useRef<string | null>(null);

  useEffect(() => {
    setExpired(false);
    if (!activeId || !startedAt) return;
    const remaining =
      ACTIVE_GENERATION_WAIT_LIMIT_MS - (Date.now() - Date.parse(startedAt));
    if (!Number.isFinite(remaining)) return;
    if (remaining <= 0) {
      setExpired(true);
      return;
    }
    const timer = window.setTimeout(() => setExpired(true), remaining);
    return () => window.clearTimeout(timer);
  }, [activeId, startedAt]);

  // 세션을 바꾸면 다시 센다 — 이전 세션의 종료를 새 세션에 적용하지 않는다.
  useEffect(() => {
    observed.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !loaded) return;
    if (activeId) {
      observed.current = activeId;
      return;
    }
    if (observed.current === "idle") return;
    const wasActive = observed.current !== null;
    observed.current = "idle";
    // 서버가 응답으로 "진행 중 아님"을 확인했을 때만 표시를 지운다.
    clearPendingDesign();
    settle.current();
    if (!wasActive) return;
    void Promise.all([
      queryClient.invalidateQueries({
        queryKey: designTurnsQueryKey(sessionId),
      }),
      queryClient.invalidateQueries({ queryKey: getTokenBalanceQueryKey() }),
      queryClient.invalidateQueries({ queryKey: listDesignSessionsQueryKey() }),
    ]);
  }, [activeId, loaded, queryClient, sessionId]);

  return { recovering: !!activeId && !expired, expired: !!activeId && expired };
}

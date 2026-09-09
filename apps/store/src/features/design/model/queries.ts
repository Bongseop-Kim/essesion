import type { DesignSessionOut, GenerationJobOut } from "@essesion/api-client";
import {
  getDesignSessionOptions,
  getDesignSessionQueryKey,
  listDesignSessionsOptions,
  listDesignTurnsOptions,
  listDesignTurnsQueryKey,
  listGenerationJobsInfiniteOptions,
} from "@essesion/api-client/query";

export const FINALIZED_JOBS_PAGE_SIZE = 20;

/** 진행 중 생성을 서버에서 다시 보는 간격 — `active_generation_id`가 있는 동안만 돈다. */
export const ACTIVE_GENERATION_POLL_MS = 2_000;
/** api의 worker 대기 상한(`worker_timeout_seconds` 180s) + 완료 커밋 여유. 그 뒤엔 느리게 본다. */
const ACTIVE_GENERATION_SLOW_AFTER_MS = 4 * 60_000;
export const ACTIVE_GENERATION_SLOW_POLL_MS = 30_000;
/** 대기 상한 — api의 stale 생성 회수 시간(design/router.py `STALE_GENERATION_JOB_AFTER`)과 맞춘다. */
export const ACTIVE_GENERATION_WAIT_LIMIT_MS = 75 * 60_000;

export type ActiveGenerationWait = "fast" | "slow" | "expired";

/**
 * 서버가 아직 생성 중인가 — null이면 진행 중인 생성이 없다.
 *
 * `expired`는 "실패했다"가 아니라 "여기서 기다리는 건 그만둔다"다. 성공·환불 판정은
 * 서버(회수 또는 복구 배치)만 한다.
 */
export function activeGenerationWait(
  session: DesignSessionOut | undefined,
  now = Date.now(),
): ActiveGenerationWait | null {
  if (!session?.active_generation_id) return null;
  const startedAt = Date.parse(session.active_generation_started_at ?? "");
  // 시작 시각을 못 읽으면 경과를 셀 수 없다 — 만료로 단정하지 않고 느리게만 본다.
  if (Number.isNaN(startedAt)) return "slow";
  const elapsed = now - startedAt;
  if (elapsed >= ACTIVE_GENERATION_WAIT_LIMIT_MS) return "expired";
  return elapsed >= ACTIVE_GENERATION_SLOW_AFTER_MS ? "slow" : "fast";
}

export function designSessionsQueryOptions(authenticated: boolean) {
  return {
    ...listDesignSessionsOptions(),
    enabled: authenticated,
  };
}

export const designSessionQueryKey = (sessionId: string) =>
  getDesignSessionQueryKey({ path: { session_id: sessionId } });

export function designSessionQueryOptions({
  sessionId,
  authenticated,
}: {
  authenticated: boolean;
  sessionId: string | null;
}) {
  return {
    ...getDesignSessionOptions({ path: { session_id: sessionId ?? "" } }),
    enabled: authenticated && !!sessionId,
    // 원래 mutation을 잃은 새로고침 이후에도 서버 완료를 관찰할 수 있어야 한다.
    refetchInterval: (query: {
      state: { status: string; data: DesignSessionOut | undefined };
    }) => {
      // 조회가 실패했으면 스스로 다시 돌지 않는다 — 안내 + 수동 재시도로 넘긴다.
      if (query.state.status === "error") return false;
      const wait = activeGenerationWait(query.state.data);
      if (wait === null || wait === "expired") return false;
      return wait === "slow"
        ? ACTIVE_GENERATION_SLOW_POLL_MS
        : ACTIVE_GENERATION_POLL_MS;
    },
  };
}

export const designTurnsQueryKey = (sessionId: string) =>
  listDesignTurnsQueryKey({ path: { session_id: sessionId } });

export function designTurnsQueryOptions({
  sessionId,
  authenticated,
}: {
  authenticated: boolean;
  sessionId: string | null;
}) {
  return {
    ...listDesignTurnsOptions({ path: { session_id: sessionId ?? "" } }),
    enabled: authenticated && !!sessionId,
  };
}

export function finalizedJobsInfiniteQueryOptions(authenticated: boolean) {
  return {
    ...listGenerationJobsInfiniteOptions({
      query: {
        kind: "finalize",
        status: "succeeded",
        limit: FINALIZED_JOBS_PAGE_SIZE,
      },
    }),
    enabled: authenticated,
    initialPageParam: 0,
    getNextPageParam: (
      lastPage: GenerationJobOut[],
      allPages: GenerationJobOut[][],
    ) =>
      lastPage.length === FINALIZED_JOBS_PAGE_SIZE
        ? allPages.length * FINALIZED_JOBS_PAGE_SIZE
        : undefined,
  };
}

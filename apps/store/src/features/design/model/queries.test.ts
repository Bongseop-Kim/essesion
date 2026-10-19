import type { DesignSessionOut } from "@essesion/api-client";
import { describe, expect, it } from "vitest";

import {
  ACTIVE_GENERATION_POLL_MS,
  ACTIVE_GENERATION_SLOW_POLL_MS,
  ACTIVE_GENERATION_WAIT_LIMIT_MS,
  designSessionQueryOptions,
} from "./queries";

function runningSince(elapsedMs: number) {
  return {
    active_generation_id: "11111111-1111-4111-8111-111111111111",
    active_generation_started_at: new Date(
      Date.now() - elapsedMs,
    ).toISOString(),
  } as DesignSessionOut;
}

describe("designSessionQueryOptions", () => {
  const { refetchInterval } = designSessionQueryOptions({
    sessionId: "session-1",
    authenticated: true,
  });
  const state = (data: DesignSessionOut | undefined, status = "success") => ({
    state: { status, data },
  });

  it("진행 중 생성이 있는 동안만 재조회한다", () => {
    expect(refetchInterval(state(undefined))).toBe(false);
    expect(refetchInterval(state({} as DesignSessionOut))).toBe(false);
    expect(refetchInterval(state(runningSince(0)))).toBe(
      ACTIVE_GENERATION_POLL_MS,
    );
  });

  it("api 대기 상한을 넘기면 느리게 보고, 회수 시간을 넘기면 멈춘다", () => {
    expect(refetchInterval(state(runningSince(5 * 60_000)))).toBe(
      ACTIVE_GENERATION_SLOW_POLL_MS,
    );
    expect(
      refetchInterval(state(runningSince(ACTIVE_GENERATION_WAIT_LIMIT_MS))),
    ).toBe(false);
  });

  it("조회가 실패했으면 스스로 다시 돌지 않는다", () => {
    expect(refetchInterval(state(runningSince(0), "error"))).toBe(false);
  });
});

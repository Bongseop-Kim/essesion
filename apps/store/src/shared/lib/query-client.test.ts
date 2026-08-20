import { describe, expect, it } from "vitest";

import { FOCUS_REFETCH } from "./live-queries";
import { queryClient } from "./query-client";

describe("store query defaults", () => {
  it('전역은 staleTime을 존중한다 — "always"는 포커스마다 활성 쿼리 전부를 재요청해 금지', () => {
    expect(queryClient.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(
      true,
    );
  });

  it("항상 신선해야 하는 쿼리는 FOCUS_REFETCH opt-in으로 포커스마다 재요청된다", () => {
    // staleTime 0 + refetchOnWindowFocus: true = 포커스 시 항상 stale → 항상 재요청.
    // 전역 정책이 바뀌어도 e2e-02 경로(admin 변경 → store 탭 복귀 반영)가 유지된다.
    expect(FOCUS_REFETCH).toEqual({ staleTime: 0, refetchOnWindowFocus: true });
  });
});

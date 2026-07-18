import { describe, expect, it } from "vitest";

import {
  FINALIZE_JOB_POLL_INTERVAL_MS,
  FINALIZE_JOB_POLL_TIMEOUT_MS,
  FINALIZE_JOB_SLOW_POLL_INTERVAL_MS,
  finalizeJobDelayed,
  finalizeJobPollInterval,
  finalizeRetryInput,
} from "./use-finalize-job";

describe("finalizeJobPollInterval", () => {
  const now = Date.parse("2026-07-11T10:00:00.000Z");

  it.each([
    "queued",
    "processing",
  ])("%s 잡은 5분 전까지 2.5초 간격으로 폴링한다", (status) => {
    expect(
      finalizeJobPollInterval(
        {
          status,
          created_at: new Date(
            now - FINALIZE_JOB_POLL_TIMEOUT_MS + 1,
          ).toISOString(),
        },
        now,
      ),
    ).toBe(FINALIZE_JOB_POLL_INTERVAL_MS);
  });

  it.each([
    "succeeded",
    "failed",
    "canceled",
  ])("%s 잡은 폴링하지 않는다", (status) => {
    expect(
      finalizeJobPollInterval(
        {
          status,
          created_at: new Date(now - 1_000).toISOString(),
        },
        now,
      ),
    ).toBe(false);
  });

  it("생성 후 5분이 된 활성 잡은 저빈도 폴링으로 전환한다", () => {
    expect(
      finalizeJobPollInterval(
        {
          status: "queued",
          created_at: new Date(
            now - FINALIZE_JOB_POLL_TIMEOUT_MS,
          ).toISOString(),
        },
        now,
      ),
    ).toBe(FINALIZE_JOB_SLOW_POLL_INTERVAL_MS);
  });

  it("잡이 없으면 폴링하지 않고, 생성 시각이 잘못되면 저빈도 폴링한다", () => {
    expect(finalizeJobPollInterval(undefined, now)).toBe(false);
    expect(
      finalizeJobPollInterval(
        { status: "processing", created_at: "invalid" },
        now,
      ),
    ).toBe(FINALIZE_JOB_SLOW_POLL_INTERVAL_MS);
  });
});

describe("finalizeJobDelayed", () => {
  const now = Date.parse("2026-07-11T10:00:00.000Z");

  it("5분이 지난 활성 잡만 지연으로 본다", () => {
    expect(
      finalizeJobDelayed(
        {
          status: "queued",
          created_at: new Date(
            now - FINALIZE_JOB_POLL_TIMEOUT_MS,
          ).toISOString(),
        },
        now,
      ),
    ).toBe(true);
    expect(
      finalizeJobDelayed(
        {
          status: "processing",
          created_at: new Date(
            now - FINALIZE_JOB_POLL_TIMEOUT_MS + 1,
          ).toISOString(),
        },
        now,
      ),
    ).toBe(false);
  });

  it("종결된 잡은 지연이 아니다", () => {
    expect(
      finalizeJobDelayed(
        {
          status: "canceled",
          created_at: new Date(
            now - FINALIZE_JOB_POLL_TIMEOUT_MS,
          ).toISOString(),
        },
        now,
      ),
    ).toBe(false);
  });
});

describe("finalizeRetryInput", () => {
  it("실패한 작업의 원래 세션과 모든 생성 파라미터를 복원한다", () => {
    expect(
      finalizeRetryInput({
        id: "10000000-0000-4000-8000-000000000001",
        session_id: "20000000-0000-4000-8000-000000000001",
        kind: "finalize",
        status: "failed",
        params: {
          intent: { motif: "stripe", density: 0.4 },
          colorway_id: "navy",
          production_method: "yarn_dyed",
          weave: "jacquard",
          dpi: 300,
          material_map: { foreground: "cotton" },
          texture_strength: 0.7,
          relief_strength: 0.2,
        },
        attempts: 1,
        created_at: "2026-07-11T10:00:00.000Z",
        updated_at: "2026-07-11T10:00:01.000Z",
        error_message: "worker failed",
        request_id: null,
        result: null,
        result_url: null,
      }),
    ).toEqual({
      sessionId: "20000000-0000-4000-8000-000000000001",
      request: {
        intent: { motif: "stripe", density: 0.4 },
        colorway_id: "navy",
        production_method: "yarn_dyed",
        weave: "jacquard",
        dpi: 300,
        material_map: { foreground: "cotton" },
        texture_strength: 0.7,
        relief_strength: 0.2,
      },
    });
  });

  it("취소된 작업도 재시도 입력을 복원한다", () => {
    expect(
      finalizeRetryInput({
        id: "10000000-0000-4000-8000-000000000002",
        session_id: "20000000-0000-4000-8000-000000000001",
        kind: "finalize",
        status: "canceled",
        params: {
          intent: { motif: "dot" },
          colorway_id: null,
          production_method: "print",
          weave: "twill-45",
          dpi: 300,
        },
        attempts: 0,
        created_at: "2026-07-11T10:00:00.000Z",
        updated_at: "2026-07-11T10:00:01.000Z",
        error_message: "사용자가 finalize 작업을 취소했습니다",
        request_id: null,
        result: null,
        result_url: null,
      }),
    ).toEqual({
      sessionId: "20000000-0000-4000-8000-000000000001",
      request: {
        intent: { motif: "dot" },
        colorway_id: null,
        production_method: "print",
        weave: "twill-45",
        dpi: 300,
      },
    });
  });

  it("원래 입력을 정확히 복원할 수 없는 작업은 재시도하지 않는다", () => {
    const base = {
      id: "10000000-0000-4000-8000-000000000001",
      session_id: "20000000-0000-4000-8000-000000000001",
      kind: "finalize",
      status: "failed",
      attempts: 1,
      created_at: "2026-07-11T10:00:00.000Z",
      updated_at: "2026-07-11T10:00:01.000Z",
      error_message: "worker failed",
      request_id: null,
      result: null,
      result_url: null,
    };

    expect(
      finalizeRetryInput({
        ...base,
        params: {
          intent: { motif: "stripe" },
          colorway_id: "navy",
          production_method: "print",
          weave: "twill-45",
        },
      }),
    ).toBeNull();
    expect(
      finalizeRetryInput({
        ...base,
        status: "succeeded",
        params: {
          intent: { motif: "stripe" },
          colorway_id: "navy",
          production_method: "print",
          weave: "twill-45",
          dpi: 300,
        },
      }),
    ).toBeNull();
  });
});

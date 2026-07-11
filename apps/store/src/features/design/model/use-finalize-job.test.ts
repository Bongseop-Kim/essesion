import { describe, expect, it } from "vitest";

import {
  FINALIZE_JOB_POLL_INTERVAL_MS,
  FINALIZE_JOB_POLL_TIMEOUT_MS,
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

  it.each(["succeeded", "failed"])("%s 잡은 폴링하지 않는다", (status) => {
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

  it("생성 후 5분이 된 활성 잡은 폴링을 중단한다", () => {
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
    ).toBe(false);
  });

  it("잡이 없거나 생성 시각이 잘못되면 폴링하지 않는다", () => {
    expect(finalizeJobPollInterval(undefined, now)).toBe(false);
    expect(
      finalizeJobPollInterval(
        { status: "processing", created_at: "invalid" },
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

import { describe, expect, it } from "vitest";

import {
  FINALIZE_JOB_POLL_INTERVAL_MS,
  FINALIZE_JOB_POLL_TIMEOUT_MS,
  FINALIZE_JOB_SLOW_POLL_INTERVAL_MS,
  finalizeJobPollInterval,
} from "./use-finalize-job";

describe("finalizeJobPollInterval", () => {
  const now = Date.parse("2026-07-11T10:00:00.000Z");

  it.each(["queued", "processing"])(
    "%s 잡은 5분 전까지 2.5초 간격으로 폴링한다",
    (status) => {
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
    },
  );

  it.each(["succeeded", "failed", "canceled"])(
    "%s 잡은 폴링하지 않는다",
    (status) => {
      expect(
        finalizeJobPollInterval(
          {
            status,
            created_at: new Date(now - 1_000).toISOString(),
          },
          now,
        ),
      ).toBe(false);
    },
  );

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

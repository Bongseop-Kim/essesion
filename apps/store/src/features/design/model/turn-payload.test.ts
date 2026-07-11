import { describe, expect, it } from "vitest";

import { parseDesignTurnPayload } from "./turn-payload";

describe("parseDesignTurnPayload", () => {
  it("generate_request payload를 파싱한다", () => {
    const payload = {
      type: "generate_request",
      mode: "prompt",
      prompt: "푸른 기하학 무늬",
      seed: null,
      colorway: null,
      candidate_count: 4,
    };

    expect(parseDesignTurnPayload(payload)).toEqual(payload);
  });

  it("resolved intent가 포함된 generate payload를 파싱한다", () => {
    const payload = {
      type: "generate",
      response: {
        request_id: "request-1",
        candidates: [
          {
            id: "candidate-1",
            design_index: 0,
            seed: 42,
            colorway_id: "navy",
            svg: '<svg viewBox="0 0 10 10"></svg>',
          },
        ],
        intents: [{ motif: "geometric" }],
        warnings: ["diversity shortfall"],
      },
    };

    expect(parseDesignTurnPayload(payload)).toEqual(payload);
  });

  it("select payload를 파싱한다", () => {
    const payload = {
      type: "select",
      candidate_id: "candidate-1",
      design_index: 0,
      seed: 42,
      colorway_id: "navy",
    };

    expect(parseDesignTurnPayload(payload)).toEqual(payload);
  });

  it("finalize payload를 파싱한다", () => {
    const payload = {
      type: "finalize",
      job_id: "550e8400-e29b-41d4-a716-446655440000",
      production_method: "print",
      weave: "plain",
    };

    expect(parseDesignTurnPayload(payload)).toEqual(payload);
  });

  it("알 수 없는 type과 intents가 없는 구버전 generate를 무시한다", () => {
    expect(parseDesignTurnPayload({ type: "legacy", value: 1 })).toBeNull();
    expect(
      parseDesignTurnPayload({
        type: "generate",
        response: {
          candidates: [
            {
              id: "candidate-1",
              design_index: 0,
              seed: 42,
              colorway_id: "navy",
              svg: "<svg></svg>",
            },
          ],
        },
      }),
    ).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { restoreDesignSelection } from "./selection";

describe("design selection", () => {
  it("가장 마지막 select 턴과 해당 generate 후보를 복원한다", () => {
    const turns = [
      {
        seq: 1,
        payload: {
          type: "generate",
          response: {
            run_id: "11111111-1111-4111-8111-111111111111",
            candidates: [
              {
                id: "candidate-a",
                design_index: 1,
                seed: 11,
                colorway_id: "red",
                svg: "<svg id='a'></svg>",
              },
              {
                id: "candidate-b",
                design_index: 0,
                seed: 22,
                colorway_id: "blue",
                svg: "<svg id='b'></svg>",
              },
            ],
          },
        },
      },
      {
        seq: 2,
        payload: {
          type: "select",
          candidate_id: "candidate-a",
          design_index: 1,
          seed: 11,
          colorway_id: "red",
        },
      },
      {
        seq: 4,
        payload: {
          type: "select",
          candidate_id: "candidate-b",
          design_index: 0,
          seed: 22,
          colorway_id: "blue",
        },
      },
    ];

    expect(
      restoreDesignSelection(
        {
          current_intent: { motif: "stripe" },
          seed: 22,
          colorway: "blue",
        },
        turns,
      ),
    ).toMatchObject({
      candidateId: "candidate-b",
      designIndex: 0,
      intent: { motif: "stripe" },
      seed: 22,
      colorway: "blue",
      source: "turn",
    });
  });

  it("select 턴과 세션 상태가 다르면 세션 상태를 우선한다", () => {
    expect(
      restoreDesignSelection(
        {
          current_intent: { motif: "fallback" },
          seed: 1,
          colorway: "old",
        },
        [
          {
            seq: 3,
            payload: {
              type: "select",
              candidate_id: "missing",
              design_index: 2,
              seed: 99,
              colorway_id: "green",
            },
          },
        ],
      ),
    ).toEqual({
      candidate: null,
      candidateId: null,
      designIndex: null,
      intent: { motif: "fallback" },
      seed: 1,
      colorway: "old",
      source: "session",
    });
  });

  it("엔진 팬아웃 intent가 authored base와 달라도 선택 후보를 복원한다", () => {
    const turns = [
      {
        seq: 1,
        payload: {
          type: "generate",
          response: {
            run_id: "44444444-4444-4444-8444-444444444444",
            candidates: [
              {
                id: "candidate-layout",
                design_index: 0,
                seed: 33,
                colorway_id: "default",
                svg: "<svg id='layout'></svg>",
              },
            ],
          },
        },
      },
      {
        seq: 2,
        payload: {
          type: "select",
          candidate_id: "candidate-layout",
          design_index: 0,
          seed: 33,
          colorway_id: "default",
        },
      },
    ];

    expect(
      restoreDesignSelection(
        {
          current_intent: { layout: "engine-fanout-candidate" },
          seed: 33,
          colorway: "default",
        },
        turns,
      ),
    ).toMatchObject({
      candidateId: "candidate-layout",
      intent: { layout: "engine-fanout-candidate" },
      source: "turn",
    });
  });

  it("select 턴이 없으면 세션 상태를 사용하고 intent도 없으면 null이다", () => {
    expect(
      restoreDesignSelection(
        {
          current_intent: { motif: "session" },
          seed: 7,
          colorway: "navy",
        },
        [{ seq: 1, payload: { type: "unknown" } }],
      ),
    ).toEqual({
      candidate: null,
      candidateId: null,
      designIndex: null,
      intent: { motif: "session" },
      seed: 7,
      colorway: "navy",
      source: "session",
    });
    expect(
      restoreDesignSelection(
        { current_intent: null, seed: null, colorway: null },
        [],
      ),
    ).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  intentForCandidate,
  restoreDesignSelection,
  selectionForCandidate,
} from "./selection";

describe("design selection", () => {
  it("후보 배열 위치가 아닌 design_index로 intent를 찾는다", () => {
    const candidate = {
      id: "candidate-b",
      design_index: 1,
      seed: 22,
      colorway_id: "blue",
      svg: "<svg></svg>",
    };
    const intents = [{ motif: "dot" }, { motif: "stripe" }];

    expect(intentForCandidate(candidate, intents)).toEqual({ motif: "stripe" });
    expect(selectionForCandidate(candidate, intents)).toMatchObject({
      candidateId: "candidate-b",
      designIndex: 1,
      intent: { motif: "stripe" },
      seed: 22,
      colorway: "blue",
      source: "candidate",
    });
  });

  it("가장 마지막 select 턴과 해당 generate 후보를 복원한다", () => {
    const turns = [
      {
        seq: 1,
        payload: {
          type: "generate",
          response: {
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
            intents: [{ motif: "stripe" }, { motif: "dot" }],
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

  it("select 턴 기록이 빠졌어도 세션 상태와 유일하게 일치하는 후보를 복원한다", () => {
    const currentIntent = {
      motif: "dot",
      palette: { foreground: "navy", background: "ivory" },
    };
    const turns = [
      {
        seq: 1,
        payload: {
          type: "generate",
          response: {
            candidates: [
              {
                id: "candidate-old",
                design_index: 0,
                seed: 11,
                colorway_id: "red",
                svg: "<svg id='old'></svg>",
              },
              {
                id: "candidate-current",
                design_index: 1,
                seed: 22,
                colorway_id: "blue",
                svg: "<svg id='current'></svg>",
              },
            ],
            intents: [
              { motif: "stripe" },
              {
                palette: { background: "ivory", foreground: "navy" },
                motif: "dot",
              },
            ],
          },
        },
      },
      {
        seq: 2,
        payload: {
          type: "select",
          candidate_id: "candidate-old",
          design_index: 0,
          seed: 11,
          colorway_id: "red",
        },
      },
    ];

    expect(
      restoreDesignSelection(
        { current_intent: currentIntent, seed: 22, colorway: "blue" },
        turns,
      ),
    ).toMatchObject({
      candidateId: "candidate-current",
      designIndex: 1,
      intent: currentIntent,
      seed: 22,
      colorway: "blue",
      source: "session",
    });
  });

  it("세션 상태와 일치하는 후보가 여럿이면 후보를 추측하지 않는다", () => {
    const candidate = {
      design_index: 0,
      seed: 22,
      colorway_id: "blue",
      svg: "<svg></svg>",
    };
    expect(
      restoreDesignSelection(
        { current_intent: { motif: "dot" }, seed: 22, colorway: "blue" },
        [
          {
            seq: 1,
            payload: {
              type: "generate",
              response: {
                candidates: [
                  { ...candidate, id: "candidate-a" },
                  { ...candidate, id: "candidate-b" },
                ],
                intents: [{ motif: "dot" }],
              },
            },
          },
        ],
      ),
    ).toMatchObject({
      candidate: null,
      candidateId: null,
      designIndex: null,
      intent: { motif: "dot" },
      source: "session",
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
        [{ seq: 1, payload: { type: "legacy" } }],
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

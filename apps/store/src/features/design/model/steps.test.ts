import { describe, expect, it } from "vitest";

import { readDesignHistory } from "./steps";

const RUN_1 = "11111111-1111-4111-8111-111111111111";
const RUN_2 = "22222222-2222-4222-8222-222222222222";
const RUN_3 = "33333333-3333-4333-8333-333333333333";

const generate = (
  seq: number,
  runId: string,
  svg: string,
  warnings?: unknown,
) => ({
  seq,
  payload: {
    type: "generate",
    run_id: runId,
    status: "succeeded",
    summary: "요약",
    response: {
      run_id: runId,
      design: { id: `d-${seq}`, seed: 1, colorway_id: "default", svg },
      ...(warnings ? { warnings } : {}),
    },
  },
});

const activate = (seq: number, runId: string) => ({
  seq,
  payload: { type: "activate", run_id: runId, seed: 1, colorway_id: "default" },
});

const failed = (seq: number) => ({
  seq,
  payload: {
    type: "generate_error",
    run_id: RUN_2,
    status: "error",
    error: { stage: "authoring", code: "authoring_invalid" },
  },
});

describe("readDesignHistory", () => {
  it("성공 스텝만 번호를 받고 실패는 칸만 남기며 포인터는 마지막 activate다", () => {
    const history = readDesignHistory([
      generate(1, RUN_1, "<svg id='a'/>"),
      activate(2, RUN_1),
      failed(3),
      generate(4, RUN_3, "<svg id='b'/>"),
      activate(5, RUN_3),
    ]);

    expect(history.cells).toEqual([
      expect.objectContaining({ kind: "design", label: 1, runId: RUN_1 }),
      expect.objectContaining({ kind: "failed" }),
      expect.objectContaining({ kind: "design", label: 2, runId: RUN_3 }),
    ]);
    expect(history.currentRunId).toBe(RUN_3);
    expect(history.currentSvg).toBe("<svg id='b'/>");
    // 스테퍼는 실패 칸을 건너뛴 designCells 기준으로 센다.
    expect(history.designCells.map((cell) => cell.label)).toEqual([1, 2]);
    expect(history.currentIndex).toBe(1);
  });

  it("되돌린 뒤에도 이후 스텝은 남고 포인터만 과거로 옮겨진다", () => {
    const history = readDesignHistory([
      generate(1, RUN_1, "<svg id='a'/>"),
      activate(2, RUN_1),
      generate(3, RUN_3, "<svg id='b'/>"),
      activate(4, RUN_3),
      activate(5, RUN_1),
    ]);

    expect(history.cells).toHaveLength(2);
    expect(history.currentRunId).toBe(RUN_1);
    expect(history.currentSvg).toBe("<svg id='a'/>");
    expect(history.currentIndex).toBe(0);
  });

  it("엔진 영문 진단이 담긴 turn warnings는 스텝 파싱을 막지 않는다", () => {
    const history = readDesignHistory([
      generate(1, RUN_1, "<svg id='a'/>", [
        "layer 'motif_0': size_mm 7.2 clamped to 5.52",
      ]),
      activate(2, RUN_1),
    ]);

    expect(history.cells).toHaveLength(1);
    expect(history.currentSvg).toBe("<svg id='a'/>");
  });

  it("seq가 뒤섞여 와도 순서를 복원하고 읽을 수 없는 턴은 버린다", () => {
    const history = readDesignHistory([
      activate(4, RUN_3),
      { seq: 2, payload: { type: "finalize", job_id: RUN_2 } },
      generate(3, RUN_3, "<svg id='b'/>"),
      generate(1, RUN_1, "<svg id='a'/>"),
    ]);

    expect(history.cells.map((cell) => cell.kind)).toEqual([
      "design",
      "design",
    ]);
    expect(history.currentSvg).toBe("<svg id='b'/>");
  });

  it("턴이 없으면 첫 진입 상태다", () => {
    expect(readDesignHistory(undefined)).toEqual({
      cells: [],
      designCells: [],
      currentIndex: -1,
      currentRunId: null,
      currentSvg: null,
    });
  });
});

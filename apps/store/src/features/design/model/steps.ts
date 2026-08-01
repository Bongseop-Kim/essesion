import type { DesignTurnOut } from "@essesion/api-client";

import { parseDesignTurnPayload } from "./turn-payload";

/** 하단 이력 트랙의 한 칸. 실패 칸은 번호를 차지하지 않는다. */
export type DesignHistoryCell =
  | {
      kind: "design";
      seq: number;
      runId: string;
      svg: string;
      label: number;
    }
  | { kind: "failed"; seq: number };

export type DesignHistory = {
  cells: readonly DesignHistoryCell[];
  /** 편집 포인터 — 마지막 `activate` 턴의 런. 이력 클릭이 이 값을 옮긴다. */
  currentRunId: string | null;
  /** 포인터가 가리키는 디자인 SVG (없으면 첫 진입) */
  currentSvg: string | null;
};

const EMPTY: DesignHistory = {
  cells: [],
  currentRunId: null,
  currentSvg: null,
};

/**
 * 턴 목록 → 선형 편집 이력. 서버가 생성 성공마다 `activate` 턴을 붙이므로
 * 마지막 `activate`가 편집 포인터이고, 되돌리기는 그 포인터만 옮긴다.
 */
export function readDesignHistory(
  turns: ReadonlyArray<Pick<DesignTurnOut, "seq" | "payload">> | undefined,
): DesignHistory {
  if (!turns || turns.length === 0) return EMPTY;

  const ordered = [...turns].sort((a, b) => a.seq - b.seq);
  const cells: DesignHistoryCell[] = [];
  let label = 0;
  let currentRunId: string | null = null;

  for (const turn of ordered) {
    const payload = parseDesignTurnPayload(turn.payload);
    if (!payload) continue;
    if (payload.type === "activate") {
      currentRunId = payload.run_id;
    } else if (payload.type === "generate_error") {
      cells.push({ kind: "failed", seq: turn.seq });
    } else {
      label += 1;
      cells.push({
        kind: "design",
        seq: turn.seq,
        runId: payload.response.run_id,
        svg: payload.response.design.svg,
        label,
      });
    }
  }

  const current = cells.find(
    (cell) => cell.kind === "design" && cell.runId === currentRunId,
  );
  return {
    cells,
    currentRunId,
    currentSvg: current?.kind === "design" ? current.svg : null,
  };
}

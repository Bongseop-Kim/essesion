import type { DesignTurnOut, GenerationJobOut } from "@essesion/api-client";
import { describe, expect, it } from "vitest";

import { mergeFinalizeTurns } from "./finalize-turns";

const SESSION_ID = "20000000-0000-4000-8000-000000000001";

describe("mergeFinalizeTurns", () => {
  it("서버 turn, 로컬 복구, job 복구를 중복 없이 시간순으로 합친다", () => {
    const server = finalizeTurn({
      id: "server-turn",
      jobId: "10000000-0000-4000-8000-000000000001",
      createdAt: "2026-07-11T10:02:00.000Z",
    });
    const recoveredJob = finalizeJob({
      id: "10000000-0000-4000-8000-000000000002",
      createdAt: "2026-07-11T10:01:00.000Z",
    });

    const merged = mergeFinalizeTurns(
      [server],
      [
        recoveredJob,
        finalizeJob({
          id: "10000000-0000-4000-8000-000000000001",
          createdAt: "2026-07-11T10:02:00.000Z",
        }),
      ],
      [
        {
          sessionId: SESSION_ID,
          type: "finalize",
          job_id: recoveredJob.id,
          production_method: "yarn_dyed",
          weave: "jacquard",
          createdAt: "2026-07-11T10:01:30.000Z",
        },
      ],
      SESSION_ID,
    );

    expect(merged.map((turn) => turn.id)).toEqual([
      `local-finalize-${recoveredJob.id}`,
      "server-turn",
    ]);
    expect(merged[0]?.payload).toEqual({
      type: "finalize",
      job_id: recoveredJob.id,
      production_method: "yarn_dyed",
      weave: "jacquard",
    });
  });

  it("활성 세션의 finalize job만 복구하고 누락된 옵션에는 안전한 기본값을 쓴다", () => {
    const wanted = finalizeJob({
      id: "10000000-0000-4000-8000-000000000003",
      createdAt: "2026-07-11T10:00:00.000Z",
      params: {},
    });
    const otherSession = finalizeJob({
      id: "10000000-0000-4000-8000-000000000004",
      createdAt: "2026-07-11T10:01:00.000Z",
      sessionId: "20000000-0000-4000-8000-000000000002",
    });
    const exportJob = finalizeJob({
      id: "10000000-0000-4000-8000-000000000005",
      createdAt: "2026-07-11T10:02:00.000Z",
      kind: "export",
    });

    const merged = mergeFinalizeTurns(
      [],
      [wanted, otherSession, exportJob],
      [
        {
          sessionId: otherSession.session_id ?? "",
          type: "finalize",
          job_id: "10000000-0000-4000-8000-000000000006",
          production_method: "print",
          weave: "twill-0",
          createdAt: "2026-07-11T09:00:00.000Z",
        },
      ],
      SESSION_ID,
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.payload).toEqual({
      type: "finalize",
      job_id: wanted.id,
      production_method: "print",
      weave: "twill-45",
    });
  });
});

function finalizeTurn({
  id,
  jobId,
  createdAt,
}: {
  id: string;
  jobId: string;
  createdAt: string;
}): DesignTurnOut {
  return {
    id,
    seq: 1,
    role: "user",
    payload: {
      type: "finalize",
      job_id: jobId,
      production_method: "print",
      weave: "twill-45",
    },
    created_at: createdAt,
  };
}

function finalizeJob({
  id,
  createdAt,
  sessionId = SESSION_ID,
  kind = "finalize",
  params = { production_method: "print", weave: "twill-45" },
}: {
  id: string;
  createdAt: string;
  sessionId?: string;
  kind?: string;
  params?: Record<string, unknown>;
}): GenerationJobOut {
  return {
    id,
    attempts: 0,
    created_at: createdAt,
    updated_at: createdAt,
    error_message: null,
    kind,
    params,
    request_id: null,
    result: null,
    result_url: null,
    session_id: sessionId,
    status: "queued",
  };
}

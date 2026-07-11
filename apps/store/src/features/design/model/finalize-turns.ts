import type { DesignTurnOut, GenerationJobOut } from "@essesion/api-client";

import { parseDesignTurnPayload } from "./turn-payload";

export type LocalFinalizeTurn = {
  sessionId: string;
  type: "finalize";
  job_id: string;
  production_method: string;
  weave: string;
  createdAt: string;
};

export function mergeFinalizeTurns(
  turns: readonly DesignTurnOut[],
  jobs: readonly GenerationJobOut[],
  local: readonly LocalFinalizeTurn[],
  sessionId: string | null,
): DesignTurnOut[] {
  const jobIds = new Set<string>();
  const merged = turns.filter((turn) => {
    const payload = parseDesignTurnPayload(turn.payload);
    if (payload?.type !== "finalize") return true;
    if (jobIds.has(payload.job_id)) return false;
    jobIds.add(payload.job_id);
    return true;
  });
  const maxSeq = merged.reduce((max, turn) => Math.max(max, turn.seq), 0);
  const missing = [
    ...local
      .filter((turn) => turn.sessionId === sessionId)
      .map((turn) => ({
        id: `local-finalize-${turn.job_id}`,
        jobId: turn.job_id,
        createdAt: turn.createdAt,
        productionMethod: turn.production_method,
        weave: turn.weave,
      })),
    ...jobs
      .filter(
        (job) =>
          job.kind === "finalize" &&
          job.session_id === sessionId &&
          !jobIds.has(job.id),
      )
      .map((job) => ({
        id: `recovered-finalize-${job.id}`,
        jobId: job.id,
        createdAt: job.created_at,
        productionMethod: stringParam(job.params.production_method, "print"),
        weave: stringParam(job.params.weave, "twill-45"),
      })),
  ]
    .filter((turn) => {
      if (jobIds.has(turn.jobId)) return false;
      jobIds.add(turn.jobId);
      return true;
    })
    .sort(
      (left, right) => timestamp(left.createdAt) - timestamp(right.createdAt),
    )
    .map<DesignTurnOut>((turn, index) => ({
      id: turn.id,
      seq: maxSeq + index + 1,
      role: "user",
      payload: {
        type: "finalize",
        job_id: turn.jobId,
        production_method: turn.productionMethod,
        weave: turn.weave,
      },
      created_at: turn.createdAt,
    }));

  return [...merged, ...missing].sort((left, right) => {
    const createdAtDelta =
      timestamp(left.created_at) - timestamp(right.created_at);
    return createdAtDelta || left.seq - right.seq;
  });
}

function stringParam(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

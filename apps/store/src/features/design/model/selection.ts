import type {
  DesignSessionOut,
  DesignTurnOut,
  WorkerCandidateOut,
} from "@essesion/api-client";

import { type DesignTurnPayload, parseDesignTurnPayload } from "./turn-payload";

export type DesignCandidate = Pick<
  WorkerCandidateOut,
  "id" | "design_index" | "seed" | "colorway_id" | "svg"
>;

type SelectPayload = Extract<DesignTurnPayload, { type: "select" }>;

export type DesignSelection = {
  candidate: DesignCandidate | null;
  candidateId: string | null;
  designIndex: number | null;
  intent: DesignSessionOut["current_intent"];
  seed: number | null;
  colorway: string | null;
  source: "candidate" | "turn" | "session";
};

type ParsedTurn = {
  seq: number;
  payload: DesignTurnPayload;
};

function latestSelect(turns: ParsedTurn[]):
  | (ParsedTurn & {
      payload: SelectPayload;
    })
  | null {
  let latest: (ParsedTurn & { payload: SelectPayload }) | null = null;
  for (const turn of turns) {
    if (turn.payload.type !== "select") continue;
    if (!latest || turn.seq > latest.seq)
      latest = { ...turn, payload: turn.payload };
  }
  return latest;
}

function selectedCandidateTurn(
  turns: ParsedTurn[],
  selected: ParsedTurn & { payload: SelectPayload },
): DesignCandidate | null {
  let latest: {
    seq: number;
    candidate: DesignCandidate;
  } | null = null;

  for (const turn of turns) {
    if (turn.seq > selected.seq || turn.payload.type !== "generate") continue;
    const candidate = turn.payload.response.candidates.find(
      (item) => item.id === selected.payload.candidate_id,
    );
    if (candidate && (!latest || turn.seq > latest.seq)) {
      latest = { seq: turn.seq, candidate };
    }
  }

  return latest?.candidate ?? null;
}

export function restoreDesignSelection(
  session: Pick<DesignSessionOut, "current_intent" | "seed" | "colorway">,
  turns: ReadonlyArray<Pick<DesignTurnOut, "seq" | "payload">>,
): DesignSelection | null {
  if (!session.current_intent) return null;

  const parsedTurns = turns.flatMap((turn) => {
    const payload = parseDesignTurnPayload(turn.payload);
    return payload ? [{ seq: turn.seq, payload }] : [];
  });
  const selected = latestSelect(parsedTurns);

  if (selected) {
    const candidate = selectedCandidateTurn(parsedTurns, selected);
    if (
      candidate &&
      candidate.design_index === selected.payload.design_index &&
      candidate.seed === selected.payload.seed &&
      candidate.colorway_id === selected.payload.colorway_id &&
      selected.payload.seed === session.seed &&
      selected.payload.colorway_id === session.colorway
    ) {
      return {
        candidate,
        candidateId: selected.payload.candidate_id,
        designIndex: candidate.design_index,
        intent: session.current_intent,
        seed: session.seed,
        colorway: session.colorway,
        source: "turn",
      };
    }
  }

  return {
    candidate: null,
    candidateId: null,
    designIndex: null,
    intent: session.current_intent,
    seed: session.seed,
    colorway: session.colorway,
    source: "session",
  };
}

import type {
  DesignGenerateOut,
  DesignSessionOut,
  DesignTurnOut,
  WorkerCandidateOut,
} from "@essesion/api-client";

import { type DesignTurnPayload, parseDesignTurnPayload } from "./turn-payload";

export type DesignCandidate = Pick<
  WorkerCandidateOut,
  "id" | "design_index" | "seed" | "colorway_id" | "svg"
>;

type DesignIntent = DesignGenerateOut["intents"][number];
type GeneratePayload = Extract<DesignTurnPayload, { type: "generate" }>;
type SelectPayload = Extract<DesignTurnPayload, { type: "select" }>;

export type DesignSelection = {
  candidate: DesignCandidate | null;
  candidateId: string | null;
  designIndex: number | null;
  intent: DesignIntent | null;
  seed: number | null;
  colorway: string | null;
  source: "candidate" | "turn" | "session";
};

export function intentForCandidate(
  candidate: Pick<WorkerCandidateOut, "design_index">,
  intents: DesignGenerateOut["intents"],
): DesignIntent | null {
  if (!Number.isInteger(candidate.design_index) || candidate.design_index < 0) {
    return null;
  }
  return intents[candidate.design_index] ?? null;
}

export function selectionForCandidate(
  candidate: DesignCandidate,
  intents: DesignGenerateOut["intents"],
): DesignSelection | null {
  const intent = intentForCandidate(candidate, intents);
  if (!intent) return null;

  return {
    candidate,
    candidateId: candidate.id,
    designIndex: candidate.design_index,
    intent,
    seed: candidate.seed,
    colorway: candidate.colorway_id,
    source: "candidate",
  };
}

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
): { candidate: DesignCandidate; payload: GeneratePayload } | null {
  let latest: {
    seq: number;
    candidate: DesignCandidate;
    payload: GeneratePayload;
  } | null = null;

  for (const turn of turns) {
    if (turn.seq > selected.seq || turn.payload.type !== "generate") continue;
    const candidate = turn.payload.response.candidates.find(
      (item) => item.id === selected.payload.candidate_id,
    );
    if (candidate && (!latest || turn.seq > latest.seq)) {
      latest = { seq: turn.seq, candidate, payload: turn.payload };
    }
  }

  return latest;
}

function candidateForSession(
  turns: ParsedTurn[],
  session: Pick<DesignSessionOut, "current_intent" | "seed" | "colorway">,
): DesignCandidate | null {
  if (!session.current_intent) return null;

  const matches: DesignCandidate[] = [];
  for (const turn of turns) {
    if (turn.payload.type !== "generate") continue;
    for (const candidate of turn.payload.response.candidates) {
      const intent = intentForCandidate(
        candidate,
        turn.payload.response.intents,
      );
      if (
        candidate.seed === session.seed &&
        candidate.colorway_id === session.colorway &&
        sameJsonValue(intent, session.current_intent)
      ) {
        matches.push(candidate);
      }
    }
  }

  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJsonValue(value, right[index]))
    );
  }
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) &&
        sameJsonValue(leftRecord[key], rightRecord[key]),
    )
  );
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
    const generated = selectedCandidateTurn(parsedTurns, selected);
    const generatedIntent = generated
      ? intentForCandidate(
          generated.candidate,
          generated.payload.response.intents,
        )
      : null;
    if (
      generated &&
      generated.candidate.design_index === selected.payload.design_index &&
      generated.candidate.seed === selected.payload.seed &&
      generated.candidate.colorway_id === selected.payload.colorway_id &&
      selected.payload.seed === session.seed &&
      selected.payload.colorway_id === session.colorway &&
      sameJsonValue(generatedIntent, session.current_intent)
    ) {
      return {
        candidate: generated.candidate,
        candidateId: selected.payload.candidate_id,
        designIndex: generated.candidate.design_index,
        intent: session.current_intent,
        seed: session.seed,
        colorway: session.colorway,
        source: "turn",
      };
    }
  }

  const candidate = candidateForSession(parsedTurns, session);
  return {
    candidate,
    candidateId: candidate?.id ?? null,
    designIndex: candidate?.design_index ?? null,
    intent: session.current_intent,
    seed: session.seed,
    colorway: session.colorway,
    source: "session",
  };
}

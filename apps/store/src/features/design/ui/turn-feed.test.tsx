// @vitest-environment jsdom

import type { DesignTurnOut } from "@essesion/api-client";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TurnFeed } from "./turn-feed";

describe("TurnFeed generation context", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("사진 참고 방식과 색상·패턴 설정을 턴 이력에 표시한다", () => {
    const turn: DesignTurnOut = {
      id: "turn-1",
      seq: 1,
      role: "user",
      created_at: "2026-07-19T00:00:00Z",
      payload: {
        type: "generate_request",
        mode: "prompt",
        prompt: "기하학 무늬",
        seed: null,
        colorway: null,
        candidate_count: 3,
        palette: { mode: "fixed", colors: ["#112233", "#AABBCC"] },
        pattern_constraints: {
          motif_scale: "small",
          density: "dense",
          arrangement: "staggered",
          direction: "diagonal",
        },
      },
      attachments: [
        {
          kind: "photo",
          filename: "꽃.jpg",
          preview_url: "data:image/png;base64,AA==",
          purpose: "composition",
        },
      ],
    };

    const { container } = render(
      <TurnFeed
        turns={[turn]}
        onSelectCandidate={vi.fn()}
        renderFinalizeTurn={() => null}
      />,
    );

    expect(screen.getByText("색상 #112233 · #AABBCC")).toBeTruthy();
    expect(
      screen.getByText("패턴 작게 · 촘촘하게 · 엇갈림 · 대각선"),
    ).toBeTruthy();
    expect(screen.getByText("배치·구도 참고")).toBeTruthy();

    const requestTime = container.querySelector("time");
    expect(requestTime?.getAttribute("datetime")).toBe(turn.created_at);
    expect(requestTime?.textContent).toBe(
      new Intl.DateTimeFormat("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(turn.created_at)),
    );
    expect(screen.queryByText("후보 3개")).toBeNull();
  });

  it("최신 성공 run의 후보만 선택할 수 있다", () => {
    const onSelectCandidate = vi.fn();
    const makeTurn = (
      seq: number,
      runId: string,
      candidateId: string,
    ): DesignTurnOut => ({
      id: `turn-${seq}`,
      seq,
      role: "assistant",
      created_at: `2026-07-19T00:0${seq}:00Z`,
      payload: {
        type: "generate",
        response: {
          run_id: runId,
          candidates: [
            {
              id: candidateId,
              design_index: 0,
              seed: seq,
              colorway_id: "default",
              svg: "<svg/>",
            },
          ],
          warnings: [],
        },
      },
      attachments: [],
    });
    const olderRunId = "11111111-1111-4111-8111-111111111111";
    const latestRunId = "22222222-2222-4222-8222-222222222222";

    render(
      <TurnFeed
        turns={[
          makeTurn(1, olderRunId, "older-candidate"),
          makeTurn(2, latestRunId, "latest-candidate"),
        ]}
        onSelectCandidate={onSelectCandidate}
        renderFinalizeTurn={() => null}
      />,
    );

    const candidates = screen.getAllByRole("button", {
      name: "디자인 후보 1",
    });
    const olderCandidate = candidates.at(0);
    const latestCandidate = candidates.at(1);
    if (!olderCandidate || !latestCandidate) {
      throw new Error("expected one candidate from each successful run");
    }
    expect(olderCandidate.hasAttribute("disabled")).toBe(true);
    expect(latestCandidate.hasAttribute("disabled")).toBe(false);

    fireEvent.click(olderCandidate);
    fireEvent.click(latestCandidate);

    expect(onSelectCandidate).toHaveBeenCalledOnce();
    expect(onSelectCandidate).toHaveBeenCalledWith(
      latestRunId,
      expect.objectContaining({ id: "latest-candidate" }),
      expect.anything(),
    );
  });
});

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

  it("최신 후보는 선택하고 과거 후보는 새 대화 분기로 전달한다", () => {
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

    const olderCandidate = screen.getByRole("button", {
      name: "디자인 후보 1, 새 대화로 이어가기",
    });
    const latestCandidate = screen.getByRole("button", {
      name: "디자인 후보 1",
    });
    expect(olderCandidate.hasAttribute("disabled")).toBe(false);
    expect(latestCandidate.hasAttribute("disabled")).toBe(false);

    fireEvent.click(olderCandidate);
    fireEvent.click(latestCandidate);

    expect(onSelectCandidate).toHaveBeenCalledTimes(2);
    expect(onSelectCandidate).toHaveBeenNthCalledWith(
      1,
      olderRunId,
      expect.objectContaining({ id: "older-candidate" }),
      "branch",
      expect.anything(),
    );
    expect(onSelectCandidate).toHaveBeenNthCalledWith(
      2,
      latestRunId,
      expect.objectContaining({ id: "latest-candidate" }),
      "select",
      expect.anything(),
    );
  });

  it("선택 표시는 run과 candidate ID가 모두 일치할 때만 보인다", () => {
    const runIds = [
      "77777777-7777-4777-8777-777777777777",
      "88888888-8888-4888-8888-888888888888",
    ];
    const turns = runIds.map(
      (runId, index): DesignTurnOut => ({
        id: `turn-${index}`,
        seq: index + 1,
        role: "assistant",
        created_at: "2026-07-19T00:00:00Z",
        payload: {
          type: "generate",
          response: {
            run_id: runId,
            candidates: [
              {
                id: "same-candidate",
                design_index: 0,
                seed: index,
                colorway_id: "default",
                svg: "<svg/>",
              },
            ],
            warnings: [],
          },
        },
        attachments: [],
      }),
    );

    render(
      <TurnFeed
        turns={turns}
        selectedRunId={runIds[1]}
        selectedCandidateId="same-candidate"
        onSelectCandidate={vi.fn()}
        renderFinalizeTurn={() => null}
      />,
    );

    const candidates = screen.getAllByRole("button");
    expect(candidates[0]?.getAttribute("aria-pressed")).toBe("false");
    expect(candidates[1]?.getAttribute("aria-pressed")).toBe("true");
  });
});

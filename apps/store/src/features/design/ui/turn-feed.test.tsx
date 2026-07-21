// @vitest-environment jsdom

import type { DesignTurnOut } from "@essesion/api-client";
import { cleanup, render, screen } from "@testing-library/react";
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
});

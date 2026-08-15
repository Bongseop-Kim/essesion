// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CanvasNoticeLayer, designNotices } from "./canvas-notice";

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width"),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("경고는 시간이 지나면 사라지고 거절·오류는 남는다", () => {
  vi.useFakeTimers();
  const notices = designNotices({
    rejected: true,
    warnings: [{ code: "motif_dropped", message: "무늬를 빼고 만들었어요." }],
  });

  render(<CanvasNoticeLayer notices={notices} />);
  expect(screen.getByText("무늬를 빼고 만들었어요.")).toBeTruthy();

  act(() => {
    vi.advanceTimersByTime(10_000);
  });

  expect(screen.queryByText("무늬를 빼고 만들었어요.")).toBeNull();
  expect(screen.getByText(/왼쪽 모티프에서 할 수 있어요/)).toBeTruthy();
});

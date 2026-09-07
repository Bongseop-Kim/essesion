// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  CanvasNoticeLayer,
  designNotices,
  type RejectedReason,
} from "./canvas-notice";

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

const REASON_TEXT: Record<RejectedReason, RegExp> = {
  motif_change: /왼쪽 모티프에서 할 수 있어요/,
  motif_recolor: /그림 자체에 고정돼 있어/,
  motif_position: /정확한 위치로 모티프를 옮기는 건 아직 지원하지 않아요/,
  per_motif_placement:
    /하나만 따로 돌리거나 성기게 하는 건 아직 지원하지 않아요/,
  target_missing: /지금 디자인에 없어서 바꾸지 않았어요/,
};

for (const [reason, pattern] of Object.entries(REASON_TEXT) as [
  RejectedReason,
  RegExp,
][]) {
  it(`거절 사유 ${reason}는 해당 안내 문구를 보여준다`, () => {
    const notices = designNotices({
      rejected: true,
      rejectedReason: reason,
      warnings: [],
    });
    render(<CanvasNoticeLayer notices={notices} />);
    expect(screen.getByText(pattern)).toBeTruthy();
  });
}

it("사유 코드가 없는 거절은 기본(모티프 교체) 문구를 보여준다", () => {
  const notices = designNotices({ rejected: true, warnings: [] });
  render(<CanvasNoticeLayer notices={notices} />);
  expect(screen.getByText(/왼쪽 모티프에서 할 수 있어요/)).toBeTruthy();
});

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PromptBar } from "./prompt-bar";

const onSubmit = vi.fn();

function renderBar(coarsePointer = false) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: coarsePointer && query.includes("pointer: coarse"),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  render(
    <PromptBar
      value="남색으로"
      onChange={vi.fn()}
      onSubmit={onSubmit}
      onOpenIdeas={vi.fn()}
      onOpenTools={vi.fn()}
      toolsOpen={false}
      placeholder="무엇을 바꿀까요?"
    />,
  );
  return screen.getByLabelText("무엇을 바꿀까요?");
}

beforeEach(() => {
  onSubmit.mockClear();
});

afterEach(cleanup);

it("PC에서 Enter는 전송하고 Shift+Enter는 줄바꿈으로 남긴다", () => {
  const input = renderBar();

  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(onSubmit).not.toHaveBeenCalled();

  fireEvent.keyDown(input, { key: "Enter" });
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it("한글 조합 중 Enter는 전송하지 않는다", () => {
  const input = renderBar();

  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(onSubmit).not.toHaveBeenCalled();
});

it("모바일에서는 Enter를 가로채지 않는다 — 줄바꿈 수단이 사라진다", () => {
  const input = renderBar(true);

  fireEvent.keyDown(input, { key: "Enter" });
  expect(onSubmit).not.toHaveBeenCalled();
});

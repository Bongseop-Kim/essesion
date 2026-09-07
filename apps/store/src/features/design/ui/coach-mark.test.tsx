// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CoachMark } from "./coach-mark";

beforeEach(() => {
  // 프리미티브(Box)가 브레이크포인트를 읽는다 — jsdom엔 matchMedia가 없다.
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  // jsdom엔 checkVisibility가 없다 — display:none만 숨김으로 친다.
  Object.defineProperty(HTMLElement.prototype, "checkVisibility", {
    configurable: true,
    value(this: HTMLElement) {
      return this.style.display !== "none";
    },
  });
});

afterEach(cleanup);

function renderCoach(onClose = vi.fn()) {
  render(
    <>
      <div data-coach="prompt">입력창</div>
      <div data-coach="motifs" style={{ display: "none" }}>
        모티프
      </div>
      <div data-coach="tools">도구</div>
      <CoachMark open onClose={onClose} />
    </>,
  );
  return onClose;
}

it("보이는 타깃만 스텝으로 세고 마지막 완료에서 닫는다", () => {
  const onClose = renderCoach();

  const first = screen.getByRole("dialog", { name: "문장으로 만들고 고쳐요" });
  expect(within(first).getByText("1 / 2")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  screen.getByRole("dialog", { name: "내려받기와 목록" });
  expect(onClose).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "완료" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("Esc는 건너뛰기와 같다", () => {
  const onClose = renderCoach();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("타깃이 하나도 없으면 바로 닫는다", () => {
  const onClose = vi.fn();
  render(<CoachMark open onClose={onClose} />);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
});

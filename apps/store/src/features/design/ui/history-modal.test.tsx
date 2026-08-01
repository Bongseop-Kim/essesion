// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesignHistoryCell } from "@/features/design/model/steps";

import { HistoryModal } from "./history-modal";

const cells: DesignHistoryCell[] = [
  {
    kind: "design",
    seq: 1,
    runId: "run-1",
    svg: "<svg id='a'/>",
    label: 1,
  },
  { kind: "failed", seq: 2 },
  {
    kind: "design",
    seq: 3,
    runId: "run-2",
    svg: "<svg id='b'/>",
    label: 2,
  },
];

function renderModal() {
  const onSelect = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <HistoryModal
      open
      onOpenChange={onOpenChange}
      cells={cells}
      currentRunId="run-2"
      onSelect={onSelect}
    />,
  );
  return { onSelect, onOpenChange };
}

describe("HistoryModal grid", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("실패 칸은 격자에 남되 누를 수 없다", () => {
    renderModal();

    screen.getByLabelText("실패한 요청");
    expect(
      screen
        .queryAllByRole("button", { name: /디자인/ })
        .map((b) => b.ariaLabel),
    ).toEqual(["1번째 디자인으로 되돌리기", "2번째 디자인, 현재 편집 중"]);
  });

  it("칸을 고르면 되돌리고 닫는다 — 현재 칸은 닫기만 한다", () => {
    const { onSelect, onOpenChange } = renderModal();

    fireEvent.click(
      screen.getByRole("button", { name: "1번째 디자인으로 되돌리기" }),
    );
    expect(onSelect).toHaveBeenCalledWith("run-1");
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onSelect.mockClear();
    fireEvent.click(
      screen.getByRole("button", { name: "2번째 디자인, 현재 편집 중" }),
    );
    expect(onSelect).not.toHaveBeenCalled();
  });
});

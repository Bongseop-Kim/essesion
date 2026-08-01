// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Modal } from "./modal";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
  vi.stubGlobal(
    "matchMedia",
    (query: string): MediaQueryList => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Modal cancel 이벤트", () => {
  it("내부 file input의 선택 취소로는 닫히지 않는다", () => {
    const onOpenChange = vi.fn();
    render(
      <Modal open title="제목" onOpenChange={onOpenChange}>
        <input type="file" aria-label="파일 선택" />
      </Modal>,
    );

    fireEvent(
      screen.getByLabelText("파일 선택"),
      new Event("cancel", { bubbles: true, cancelable: true }),
    );

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("dialog 자신의 cancel(ESC)은 그대로 닫는다", () => {
    const onOpenChange = vi.fn();
    render(<Modal open title="제목" onOpenChange={onOpenChange} />);

    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: true, cancelable: true }),
    );

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

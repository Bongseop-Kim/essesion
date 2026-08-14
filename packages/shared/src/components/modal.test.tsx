// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
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

  it("이름 있는 dialog로 노출되고 controlled ESC가 실제 open 상태를 닫는다", () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return <Modal open={open} title="쿠폰 선택" onOpenChange={setOpen} />;
    }
    render(<Harness />);

    const dialog = screen.getByRole("dialog", { name: "쿠폰 선택" });
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");

    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));

    expect(dialog.hasAttribute("open")).toBe(false);
  });

  it("부모가 닫힌 dialog를 즉시 unmount해도 trigger로 focus를 복원한다", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            쿠폰 선택
          </button>
          {open && <Modal open title="쿠폰 선택" onOpenChange={setOpen} />}
        </>
      );
    }
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "쿠폰 선택" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent(
      screen.getByRole("dialog", { name: "쿠폰 선택" }),
      new Event("cancel", { bubbles: true, cancelable: true }),
    );

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

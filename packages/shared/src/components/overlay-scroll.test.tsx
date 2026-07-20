// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BottomSheet } from "./bottom-sheet";
import { Modal } from "./modal";
import { SwipeableMenuSheet } from "./swipeable-menu-sheet";

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

describe("overlay scroll ownership", () => {
  it("Modal은 dialog가 아니라 콘텐츠 바디를 스크롤한다", () => {
    render(
      <Modal open title="제목">
        긴 콘텐츠
      </Modal>,
    );

    const dialog = screen.getByRole("dialog");
    const layout = dialog.firstElementChild as HTMLElement;
    const body = dialog.querySelector(".overscroll-contain") as HTMLElement;

    expect(dialog.classList.contains("overflow-hidden")).toBe(true);
    expect(dialog.style.maxHeight).toBe("var(--size-modal-max-height)");
    expect(layout.style.maxHeight).toBe("var(--size-modal-max-height)");
    expect(body.style.minHeight).toBe("0");
    expect(body.style.overflowY).toBe("auto");
  });

  it("BottomSheet는 viewport 안에서 콘텐츠 바디를 스크롤한다", () => {
    render(
      <BottomSheet open title="제목">
        긴 콘텐츠
      </BottomSheet>,
    );

    const dialog = screen.getByRole("dialog");
    const layout = dialog.firstElementChild as HTMLElement;
    const body = dialog.querySelector(".overscroll-contain") as HTMLElement;

    expect(dialog.classList.contains("max-h-dvh")).toBe(true);
    expect(dialog.classList.contains("overflow-hidden")).toBe(true);
    expect(layout.classList.contains("max-h-dvh")).toBe(true);
    expect(body.style.minHeight).toBe("0");
    expect(body.style.overflowY).toBe("auto");
  });

  it("SwipeableMenuSheet도 긴 액션 목록의 스크롤을 내부에 유지한다", () => {
    render(
      <SwipeableMenuSheet open title="메뉴">
        <span>긴 액션 목록</span>
      </SwipeableMenuSheet>,
    );

    const body = screen.getByText("긴 액션 목록").parentElement as HTMLElement;

    expect(body.style.minHeight).toBe("0");
    expect(body.style.overflowY).toBe("auto");
    expect(body.classList.contains("overscroll-contain")).toBe(true);
  });
});

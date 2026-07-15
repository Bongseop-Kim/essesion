// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActionButton } from "./action-button";
import { Header } from "./header";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

describe("Header", () => {
  it("모바일 푸터 액션이 메뉴를 닫을 수 있다", () => {
    render(
      <Header
        brandLabel="ESSE SION"
        brandHref="/"
        navItems={[]}
        activePathname="/"
        renderLink={(item, props) => <a href={item.href} {...props} />}
        menuIcon={<span aria-hidden="true">메뉴</span>}
        showDesktopNavigation={false}
        mobileMenuFooter={(closeMenu) => (
          <ActionButton onClick={closeMenu}>로그인</ActionButton>
        )}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
    const dialog = screen.getByRole("dialog", { name: "메뉴" });
    expect(dialog.hasAttribute("open")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    expect(dialog.hasAttribute("open")).toBe(false);
  });
});

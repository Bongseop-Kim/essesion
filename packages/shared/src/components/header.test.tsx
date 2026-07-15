// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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

  it("모바일 메뉴를 구분선과 접근 가능한 업무 그룹으로 나눈다", () => {
    const items = [
      { key: "orders", label: "주문 관리", href: "/orders" },
      { key: "settings", label: "설정", href: "/settings" },
    ];
    render(
      <Header
        brandLabel="ESSE SION 관리자"
        brandHref="/"
        navItems={items}
        mobileNavGroups={[
          { key: "operations", label: "운영", items: [items[0]!] },
          { key: "system", label: "시스템", items: [items[1]!] },
        ]}
        activePathname="/orders/ORDER-1"
        renderLink={(item, props) => <a href={item.href} {...props} />}
        menuIcon={<span aria-hidden="true">메뉴</span>}
        showDesktopNavigation={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));

    const dialog = screen.getByRole("dialog", { name: "메뉴" });
    expect(
      within(dialog)
        .getAllByRole("heading")
        .map((heading) => heading.textContent),
    ).toEqual(["메뉴"]);
    expect(within(dialog).getAllByRole("separator")).toHaveLength(1);
    expect(within(dialog).getByRole("region", { name: "운영" })).toBeTruthy();
    expect(within(dialog).getByRole("region", { name: "시스템" })).toBeTruthy();
    expect(
      within(dialog)
        .getByRole("link", { name: "주문 관리" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });
});

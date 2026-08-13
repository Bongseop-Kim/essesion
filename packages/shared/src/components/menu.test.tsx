// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "./menu";

// jsdom은 Popover API를 구현하지 않는다 — 열림/닫힘 상태는 컴포넌트가
// 자체 관리하므로 no-op 스텁으로 충분하다.
beforeEach(() => {
  HTMLElement.prototype.showPopover = () => {};
  HTMLElement.prototype.hidePopover = () => {};
  vi.stubGlobal(
    "matchMedia",
    (query: string): MediaQueryList => ({
      matches: false,
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

function dispatchToggle(element: Element, newState: "open" | "closed") {
  const event = new Event("toggle", { bubbles: false });
  Object.defineProperty(event, "newState", { value: newState });
  fireEvent(element, event);
}

function renderMenu() {
  return render(
    <MenuRoot>
      <MenuTrigger>
        <button type="button">열기</button>
      </MenuTrigger>
      <MenuContent aria-label="테스트 메뉴">
        <MenuItem label="추가" />
        <MenuItem label="수정" disabled />
        <MenuItem label="삭제" />
      </MenuContent>
    </MenuRoot>,
  );
}

describe("MenuTrigger", () => {
  it("자식 버튼을 네이티브 popover 트리거로 배선한다", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "열기" });
    const content = screen.getByRole("menu", { hidden: true });

    expect(trigger).toHaveProperty("tagName", "BUTTON");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-controls")).toBe(content.id);
    expect(trigger.getAttribute("popovertarget")).toBe(content.id);
  });
});

describe("MenuItem", () => {
  it("checked 항목을 라디오 메뉴 항목으로 노출한다", () => {
    render(
      <MenuRoot>
        <MenuTrigger>
          <button type="button">열기</button>
        </MenuTrigger>
        <MenuContent aria-label="후보 수">
          <MenuItem label="1개" checked={false} />
          <MenuItem label="2개" checked />
        </MenuContent>
      </MenuRoot>,
    );

    expect(
      screen
        .getByRole("menuitemradio", { name: "1개" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      screen
        .getByRole("menuitemradio", { name: "2개" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("클릭 시 onClick 후 네이티브 popover를 닫는다", () => {
    const onAdd = vi.fn();
    const hidePopover = vi.spyOn(HTMLElement.prototype, "hidePopover");
    render(
      <MenuRoot>
        <MenuTrigger>
          <button type="button">열기</button>
        </MenuTrigger>
        <MenuContent aria-label="테스트 메뉴">
          <MenuItem label="추가" onClick={onAdd} />
          <MenuItem label="수정" disabled />
        </MenuContent>
      </MenuRoot>,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "추가" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(hidePopover).toHaveBeenCalledTimes(1);
  });
});

describe("MenuContent", () => {
  it("화살표 키로 활성 항목을 순환하고 disabled를 건너뛴다", async () => {
    renderMenu();
    const content = screen.getByRole("menu", { hidden: true });
    const add = screen.getByRole("menuitem", { name: "추가" });
    const remove = screen.getByRole("menuitem", { name: "삭제" });

    dispatchToggle(content, "open");
    await waitFor(() => expect(document.activeElement).toBe(add));
    fireEvent.keyDown(content, { key: "ArrowDown" });
    expect(document.activeElement).toBe(remove);
    fireEvent.keyDown(content, { key: "ArrowDown" });
    expect(document.activeElement).toBe(add);
    fireEvent.keyDown(content, { key: "ArrowUp" });
    expect(document.activeElement).toBe(remove);
    fireEvent.keyDown(content, { key: "Home" });
    expect(document.activeElement).toBe(add);
    fireEvent.keyDown(content, { key: "End" });
    expect(document.activeElement).toBe(remove);
  });
});

// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MenuAnchor,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from "./menu";

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

function renderMenu({
  onOpenChange,
  triggerOnClick,
}: {
  onOpenChange?: (open: boolean) => void;
  triggerOnClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
} = {}) {
  return render(
    <MenuRoot onOpenChange={onOpenChange}>
      <MenuTrigger>
        <button type="button" onClick={triggerOnClick}>
          열기
        </button>
      </MenuTrigger>
      <MenuContent aria-label="테스트 메뉴">
        <MenuItem label="추가" />
        <MenuItem label="수정" disabled />
        <MenuItem label="삭제" tone="critical" />
      </MenuContent>
    </MenuRoot>,
  );
}

describe("MenuTrigger", () => {
  it("자식 버튼에 aria를 배선하고 클릭으로 토글한다", () => {
    const onOpenChange = vi.fn();
    renderMenu({ onOpenChange });
    const trigger = screen.getByRole("button", { name: "열기" });
    const content = screen.getByRole("menu", { hidden: true });

    expect(trigger).toHaveProperty("tagName", "BUTTON");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-controls")).toBe(content.id);

    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("자식 onClick이 preventDefault하면 열리지 않는다", () => {
    const onOpenChange = vi.fn();
    renderMenu({
      onOpenChange,
      triggerOnClick: (event) => event.preventDefault(),
    });

    fireEvent.click(screen.getByRole("button", { name: "열기" }));
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("MenuItem", () => {
  it("checked 항목을 라디오 메뉴 항목으로 노출한다", () => {
    render(
      <MenuRoot defaultOpen>
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

  it("클릭 시 onClick 후 메뉴를 닫고, disabled 항목은 무반응이다", () => {
    const onOpenChange = vi.fn();
    const onAdd = vi.fn();
    render(
      <MenuRoot defaultOpen onOpenChange={onOpenChange}>
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
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(
      screen.getByRole("menuitem", { name: "수정", hidden: true }),
    );
    expect(onOpenChange).toHaveBeenCalledTimes(1);
  });

  it("tone=critical이면 critical 텍스트 색을 쓴다", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "열기" }));
    expect(screen.getByRole("menuitem", { name: "삭제" }).className).toContain(
      "text-fg-critical",
    );
  });

  it("description을 라벨 아래에 렌더한다", () => {
    render(
      <MenuRoot defaultOpen>
        <MenuTrigger>
          <button type="button">열기</button>
        </MenuTrigger>
        <MenuContent aria-label="테스트 메뉴">
          <MenuItem label="수정" description="현재 항목을 수정합니다" />
        </MenuContent>
      </MenuRoot>,
    );
    expect(
      screen.getByRole("menuitem", { name: /수정/ }).textContent,
    ).toContain("현재 항목을 수정합니다");
  });
});

describe("MenuContent", () => {
  it("화살표 키로 활성 항목을 순환하고 disabled를 건너뛴다", async () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "열기" }));
    const content = screen.getByRole("menu");
    const add = screen.getByRole("menuitem", { name: "추가" });
    const remove = screen.getByRole("menuitem", { name: "삭제" });

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

  it("네이티브 light-dismiss(toggle closed)를 상태에 동기화하고 트리거로 포커스를 복원한다", () => {
    const onOpenChange = vi.fn();
    renderMenu({ onOpenChange });
    const trigger = screen.getByRole("button", { name: "열기" });
    fireEvent.click(trigger);
    const content = screen.getByRole("menu");

    dispatchToggle(content, "closed");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });
});

describe("MenuAnchor", () => {
  it("controlled open과 함께 위치 기준점만 제공하고 클릭 배선이 없다", () => {
    const onOpenChange = vi.fn();
    render(
      <MenuRoot open onOpenChange={onOpenChange}>
        <MenuAnchor>
          <span data-testid="anchor">기준점</span>
        </MenuAnchor>
        <MenuContent aria-label="테스트 메뉴">
          <MenuItem label="추가" />
        </MenuContent>
      </MenuRoot>,
    );

    expect(screen.getByRole("menu")).toBeTruthy();
    const anchor = screen.getByTestId("anchor");
    expect(anchor.getAttribute("aria-haspopup")).toBeNull();
    fireEvent.click(anchor);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("MenuGroup", () => {
  it("MenuGroupLabel이 있을 때만 aria-labelledby를 배선한다", () => {
    render(
      <MenuRoot defaultOpen>
        <MenuTrigger>
          <button type="button">열기</button>
        </MenuTrigger>
        <MenuContent aria-label="테스트 메뉴">
          <MenuGroup>
            <MenuGroupLabel>작업</MenuGroupLabel>
            <MenuItem label="추가" />
          </MenuGroup>
          <MenuGroup>
            <MenuItem label="삭제" />
          </MenuGroup>
        </MenuContent>
      </MenuRoot>,
    );

    const [labeled, unlabeled] = screen.getAllByRole("group");
    expect(labeled?.getAttribute("aria-labelledby")).toBeTruthy();
    expect(
      document.getElementById(labeled?.getAttribute("aria-labelledby") ?? "")
        ?.textContent,
    ).toBe("작업");
    expect(unlabeled?.getAttribute("aria-labelledby")).toBeNull();
  });
});

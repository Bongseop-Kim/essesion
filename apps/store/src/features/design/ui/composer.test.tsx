// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ComposerPanelItem,
  DesignComposer,
  type DesignComposerProps,
} from "./composer";

type MutableMediaQuery = MediaQueryList & {
  matches: boolean;
  listeners: Set<() => void>;
};

const mediaQueries = new Map<string, MutableMediaQuery>();

function matchMedia(query: string): MediaQueryList {
  const existing = mediaQueries.get(query);
  if (existing) return existing;
  const listeners = new Set<() => void>();
  const result = {
    media: query,
    matches: false,
    onchange: null,
    listeners,
    addEventListener: (_type: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) =>
      listeners.delete(listener),
    addListener: (listener: () => void) => listeners.add(listener),
    removeListener: (listener: () => void) => listeners.delete(listener),
    dispatchEvent: () => true,
  } as unknown as MutableMediaQuery;
  mediaQueries.set(query, result);
  return result;
}

function setViewport(width: number) {
  for (const [query, mediaQuery] of mediaQueries) {
    const minWidth = /min-width:\s*(\d+)px/.exec(query)?.[1];
    const next = minWidth ? width >= Number(minWidth) : false;
    if (mediaQuery.matches === next) continue;
    mediaQuery.matches = next;
    for (const listener of mediaQuery.listeners) listener();
  }
}

function optionsGrid(button: HTMLElement): HTMLElement {
  let element = button.parentElement;
  while (element && !element.style.gridTemplateColumns) {
    element = element.parentElement;
  }
  if (!element) throw new Error("옵션 그리드를 찾지 못했습니다.");
  return element;
}

const baseProps: DesignComposerProps = {
  prompt: "네이비 패턴",
  candidateCount: 1,
  onPromptChange: vi.fn(),
  onCandidateCountChange: vi.fn(),
  onSubmit: vi.fn(),
  onPhotoFilesSelect: vi.fn(),
  onOpenMotifAdd: vi.fn(),
  onOpenMotifLibrary: vi.fn(),
  onOpenColors: vi.fn(),
  onOpenPatternSettings: vi.fn(),
  onOpenIdeas: vi.fn(),
};

describe("DesignComposer token purchase", () => {
  beforeEach(() => {
    HTMLElement.prototype.showPopover = () => {};
    HTMLElement.prototype.hidePopover = () => {};
    setViewport(0);
    vi.stubGlobal("matchMedia", vi.fn(matchMedia));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ["composer가 비활성화됐을 때", { disabled: true }],
    ["생성 중일 때", { loading: true }],
  ])("%s 충전 액션도 비활성화한다", (_, state) => {
    const onPurchaseTokens = vi.fn();
    render(
      <DesignComposer
        {...baseProps}
        {...state}
        onPurchaseTokens={onPurchaseTokens}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "옵션 더보기" }));
    const purchase = screen.getByRole("button", { name: "충전" });
    expect((purchase as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(purchase);
    expect(onPurchaseTokens).not.toHaveBeenCalled();
  });

  it("최종 10개 액션을 모바일 4열·데스크톱 5열 순서로 노출한다", () => {
    render(
      <DesignComposer
        {...baseProps}
        onPurchaseTokens={vi.fn()}
        sessionActions={
          <>
            <ComposerPanelItem icon={<span />} label="내 세션" />
            <ComposerPanelItem icon={<span />} label="내 완성본" />
            <ComposerPanelItem icon={<span />} label="새로 만들기" />
          </>
        }
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "옵션 더보기" }));

    const expected = [
      "사진 첨부",
      "모티프 추가",
      "내 모티프",
      "색상",
      "패턴 설정",
      "후보 1개",
      "내 세션",
      "내 완성본",
      "새로 만들기",
      "충전",
    ];
    const grid = optionsGrid(screen.getByRole("button", { name: "사진 첨부" }));
    expect(
      Array.from(grid.querySelectorAll<HTMLButtonElement>("button"))
        .filter((button) => button.getAttribute("role") === null)
        .map((button) => button.textContent?.trim()),
    ).toEqual(expected);
    expect(grid.style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");

    act(() => setViewport(1024));
    expect(grid.style.gridTemplateColumns).toBe("repeat(5, minmax(0, 1fr))");
    expect(
      screen.getByRole("button", { name: "문맥 기반 아이디어" }),
    ).toBeTruthy();
    expect(screen.queryByText("프롬프트 힌트")).toBeNull();
  });

  it("사진 참고 방식을 키보드로 바꾸고 삭제 액션과 분리한다", async () => {
    const user = userEvent.setup();
    const onPhotoPurposeChange = vi.fn();
    const onRemoveAttachment = vi.fn();
    render(
      <DesignComposer
        {...baseProps}
        attachments={[
          {
            id: "photo-1",
            kind: "photo",
            name: "꽃.jpg",
            previewSrc: "data:image/png;base64,AA==",
            purpose: "auto",
          },
        ]}
        onPhotoPurposeChange={onPhotoPurposeChange}
        onRemoveAttachment={onRemoveAttachment}
      />,
    );

    const purpose = screen.getByRole("button", {
      name: "꽃.jpg 참고 방식: 자동 판단",
    });
    purpose.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("menuitemradio", { name: "자동 판단" }),
      ),
    );
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onPhotoPurposeChange).toHaveBeenCalledWith("photo-1", "motif");
    expect(onRemoveAttachment).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "꽃.jpg 첨부 삭제" }));
    expect(onRemoveAttachment).toHaveBeenCalledWith("photo-1");
  });

  it("후보 수를 앵커 메뉴에서 선택한다", () => {
    const onCandidateCountChange = vi.fn();
    render(
      <DesignComposer
        {...baseProps}
        onCandidateCountChange={onCandidateCountChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "옵션 더보기" }));
    const candidateTrigger = screen.getByRole("button", { name: "후보 1개" });
    fireEvent.click(candidateTrigger);
    expect(candidateTrigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "3개" }));
    expect(onCandidateCountChange).toHaveBeenCalledWith(3);
  });

  it("SVG가 있으면 빈 프롬프트도 제출할 수 있다", () => {
    const onSubmit = vi.fn();
    render(
      <DesignComposer
        {...baseProps}
        prompt=""
        canSubmitWithoutPrompt
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "디자인 생성" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("사진만 첨부한 빈 프롬프트는 제출할 수 없다", () => {
    const onSubmit = vi.fn();
    render(
      <DesignComposer
        {...baseProps}
        prompt=""
        attachments={[
          {
            id: "photo-1",
            kind: "photo",
            name: "꽃.jpg",
            previewSrc: "data:image/png;base64,AA==",
          },
        ]}
        onSubmit={onSubmit}
      />,
    );
    const submit = screen.getByRole("button", { name: "디자인 생성" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("적용 중인 색상·패턴 칩을 선택 상태로 알린다", () => {
    render(
      <DesignComposer
        {...baseProps}
        paletteColors={["#112233", "#445566"]}
        patternSummary={["작게", "촘촘하게"]}
        onResetPalette={vi.fn()}
        onResetPattern={vi.fn()}
      />,
    );

    expect(
      screen
        .getByRole("button", { name: "적용 색상 전체 초기화" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "패턴 설정 전체 초기화" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

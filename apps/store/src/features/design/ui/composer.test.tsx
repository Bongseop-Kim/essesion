// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesignComposer, type DesignComposerProps } from "./composer";

const baseProps: DesignComposerProps = {
  prompt: "네이비 패턴",
  candidateCount: 1,
  onPromptChange: vi.fn(),
  onCandidateCountChange: vi.fn(),
  onSubmit: vi.fn(),
  onPhotoFilesSelect: vi.fn(),
  onSvgFilesSelect: vi.fn(),
  onOpenMotifLibrary: vi.fn(),
};

describe("DesignComposer token purchase", () => {
  beforeEach(() => {
    HTMLElement.prototype.showPopover = () => {};
    HTMLElement.prototype.hidePopover = () => {};
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
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

  it("첨부 액션을 노출하고 프롬프트 힌트는 렌더하지 않는다", () => {
    render(<DesignComposer {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "옵션 더보기" }));

    expect(screen.getByRole("button", { name: "사진 첨부" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "SVG 첨부" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "내 모티프" })).toBeTruthy();
    expect(screen.queryByText("프롬프트 힌트")).toBeNull();
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
});

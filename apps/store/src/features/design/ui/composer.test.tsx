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
};

describe("DesignComposer token purchase", () => {
  beforeEach(() => {
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
});

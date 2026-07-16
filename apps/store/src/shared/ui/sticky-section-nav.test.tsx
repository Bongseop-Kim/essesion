// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StickySectionNav } from "./sticky-section-nav";

const sections = [
  { id: "detail-info", label: "정보", content: <p>정보 내용</p> },
  { id: "detail-inquiry", label: "문의", content: <p>문의 내용</p> },
  { id: "detail-reviews", label: "후기", content: <p>후기 내용</p> },
] as const;

describe("StickySectionNav", () => {
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

  afterEach(cleanup);

  it("모든 섹션을 한 번에 렌더하고 탭을 앵커로 제공한다", () => {
    render(<StickySectionNav aria-label="상세 메뉴" sections={sections} />);

    expect(screen.getByText("정보 내용")).toBeTruthy();
    expect(screen.getByText("문의 내용")).toBeTruthy();
    expect(screen.getByText("후기 내용")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "문의" }).getAttribute("href"),
    ).toBe("#detail-inquiry");
  });

  it("선택한 섹션 링크를 현재 위치로 표시한다", () => {
    render(<StickySectionNav aria-label="상세 메뉴" sections={sections} />);

    const inquiry = screen.getByRole("link", { name: "문의" });
    fireEvent.click(inquiry);

    expect(inquiry.getAttribute("aria-current")).toBe("location");
  });
});

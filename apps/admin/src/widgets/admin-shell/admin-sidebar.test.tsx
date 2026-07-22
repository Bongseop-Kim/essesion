import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { AdminSidebar } from "./admin-sidebar";

describe("AdminSidebar", () => {
  it("구분선과 접근 가능한 업무 그룹으로 현재 상세 경로를 표시한다", () => {
    render(
      <MemoryRouter initialEntries={["/orders/ORDER-1"]}>
        <AdminSidebar />
      </MemoryRouter>,
    );

    const sidebar = screen.getByRole("navigation", { name: "관리자 메뉴" });
    expect(within(sidebar).queryAllByRole("heading")).toHaveLength(0);
    expect(within(sidebar).getAllByRole("separator")).toHaveLength(5);

    const operations = within(sidebar).getByRole("region", { name: "운영" });
    expect(
      within(operations)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "주문 관리",
      "수기 주문",
      "견적 관리",
      "클레임 관리",
      "결제 이상",
      "문의 관리",
      "후기 관리",
    ]);
    expect(
      within(within(sidebar).getByRole("region", { name: "상품·프로모션" }))
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["상품 관리", "가격 관리", "쿠폰 관리"]);
    expect(
      within(within(sidebar).getByRole("region", { name: "생성·에셋" }))
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["생성 운영", "RAG 예시", "Motif SVG"]);
    expect(
      within(sidebar)
        .getByRole("link", { name: "주문 관리" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      within(sidebar)
        .getByRole("link", { name: "대시보드" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });
});

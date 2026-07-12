import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { getVisiblePages, Pagination } from "./pagination";

describe("Pagination", () => {
  it("현재 페이지 주변을 최대 다섯 개 표시한다", () => {
    expect(getVisiblePages(1, 10)).toEqual([1, 2, 3, 4, 5]);
    expect(getVisiblePages(6, 10)).toEqual([4, 5, 6, 7, 8]);
    expect(getVisiblePages(10, 10)).toEqual([6, 7, 8, 9, 10]);
  });

  it("nav와 aria-current로 현재 페이지를 알린다", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={3} totalPages={7} onPageChange={onPageChange} />);

    expect(
      screen.getByRole("navigation", { name: "페이지 이동" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "3페이지" })
        .getAttribute("aria-current"),
    ).toBe("page");

    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });
});

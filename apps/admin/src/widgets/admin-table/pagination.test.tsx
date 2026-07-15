import { render, screen, within } from "@testing-library/react";
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

  it("현재 범위와 페이지 크기를 읽을 수 있게 표시한다", () => {
    render(
      <Pagination
        page={18}
        totalPages={18}
        total={347}
        limit={20}
        onPageChange={vi.fn()}
      />,
    );

    const summary = screen.getByRole("status");
    expect(summary.textContent).toContain("341–347 / 총 347건");
    expect(screen.getByText("페이지당 20개")).toBeTruthy();
  });

  it("옵션을 주었을 때만 페이지 크기 선택을 노출한다", async () => {
    const user = userEvent.setup();
    const onPageSizeChange = vi.fn();
    render(
      <Pagination
        page={1}
        totalPages={5}
        total={100}
        limit={20}
        pageSizeOptions={[20, 50, 100]}
        onPageSizeChange={onPageSizeChange}
        onPageChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "페이지당 표시" }));
    const dialog = await screen.findByRole("dialog", {
      name: "페이지당 표시",
    });
    await user.click(within(dialog).getByRole("button", { name: "50개" }));

    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it("범위 정보가 없으면 단일 페이지의 기존 렌더링을 유지한다", () => {
    const { container } = render(
      <Pagination page={1} totalPages={1} onPageChange={vi.fn()} />,
    );

    expect(container.childElementCount).toBe(0);
  });

  it("단일 페이지도 범위 정보가 있으면 요약만 표시한다", () => {
    render(
      <Pagination
        page={1}
        totalPages={1}
        total={7}
        limit={20}
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.getByText("1–7 / 총 7건")).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("빈 성공 결과도 0건과 페이지 크기를 명확히 표시한다", () => {
    render(
      <Pagination
        page={1}
        totalPages={1}
        total={0}
        limit={20}
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.getByText("0–0 / 총 0건")).toBeTruthy();
    expect(screen.getByText("페이지당 20개")).toBeTruthy();
  });
});

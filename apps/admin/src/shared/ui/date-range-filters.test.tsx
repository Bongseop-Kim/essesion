import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DateRangeFilters } from "./date-range-filters";

describe("DateRangeFilters", () => {
  afterEach(() => vi.useRealTimers());

  it("overlay 안에서는 중첩 dialog 없이 날짜 필드로 초안을 편집한다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T03:00:00Z"));
    const onFromChange = vi.fn();
    const onToChange = vi.fn();
    render(
      <DateRangeFilters
        presentation="inline"
        from="2026-07-01"
        to="2026-07-15"
        onFromChange={onFromChange}
        onToChange={onToChange}
      />,
    );

    const from = screen.getByLabelText("시작일 (KST)");
    const to = screen.getByLabelText("종료일 (KST)");
    expect(from.getAttribute("type")).toBe("date");
    expect(to.getAttribute("type")).toBe("date");
    expect(screen.queryByRole("button", { name: "날짜 선택" })).toBeNull();

    fireEvent.change(from, { target: { value: "2026-07-02" } });

    expect(onFromChange).toHaveBeenLastCalledWith("2026-07-02");

    fireEvent.click(screen.getByRole("button", { name: "최근 7일" }));
    expect(onFromChange).toHaveBeenLastCalledWith("2026-07-09");
    expect(onToChange).toHaveBeenLastCalledWith("2026-07-15");
  });

  it("역전된 범위는 콜백으로 전달하지 않고 날짜 삭제는 허용한다", () => {
    const onFromChange = vi.fn();
    const onToChange = vi.fn();
    render(
      <DateRangeFilters
        presentation="inline"
        from="2026-07-10"
        to="2026-07-20"
        onFromChange={onFromChange}
        onToChange={onToChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("시작일 (KST)"), {
      target: { value: "2026-07-21" },
    });
    fireEvent.change(screen.getByLabelText("종료일 (KST)"), {
      target: { value: "2026-07-09" },
    });

    expect(onFromChange).not.toHaveBeenCalled();
    expect(onToChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("시작일 (KST)"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("종료일 (KST)"), {
      target: { value: "" },
    });

    expect(onFromChange).toHaveBeenCalledWith(undefined);
    expect(onToChange).toHaveBeenCalledWith(undefined);
  });
});

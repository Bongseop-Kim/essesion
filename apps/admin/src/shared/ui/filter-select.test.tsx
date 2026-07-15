import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FilterSelect } from "./filter-select";

describe("FilterSelect", () => {
  it("overlay 안에서는 중첩 dialog 없이 라디오 목록으로 선택한다", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <FilterSelect
        label="주문 유형"
        presentation="inline"
        value="all"
        options={[
          { value: "all", label: "전체" },
          { value: "repair", label: "수선" },
        ]}
        onValueChange={onValueChange}
      />,
    );

    expect(screen.getByRole("radiogroup", { name: "주문 유형" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /주문 유형/ })).toBeNull();

    await user.click(screen.getByRole("radio", { name: "수선" }));

    expect(onValueChange).toHaveBeenCalledWith("repair");
  });
});

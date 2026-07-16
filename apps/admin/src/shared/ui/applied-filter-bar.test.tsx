import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppliedFilterBar } from "./applied-filter-bar";

describe("AppliedFilterBar", () => {
  it("활성 필터가 없으면 렌더링하지 않는다", () => {
    render(<AppliedFilterBar filters={[]} onReset={vi.fn()} />);

    expect(screen.queryByRole("group", { name: "적용된 필터" })).toBeNull();
  });

  it("필터를 접근 가능한 칩으로 표시하고 개별·전체 초기화를 실행한다", async () => {
    const user = userEvent.setup();
    const removeStatus = vi.fn();
    const onReset = vi.fn();
    render(
      <AppliedFilterBar
        filters={[
          false,
          {
            key: "status",
            label: "상태: 진행중",
            onRemove: removeStatus,
          },
        ]}
        onReset={onReset}
      />,
    );

    expect(screen.getByText("필터 1")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "상태: 진행중 필터 제거" }),
    );
    expect(removeStatus).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "전체 초기화" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

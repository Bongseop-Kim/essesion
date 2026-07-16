import { Text } from "@essesion/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CompactFilterToolbar } from "./compact-filter-toolbar";

describe("CompactFilterToolbar", () => {
  it("검색은 남는 폭을 채우고 필터 트리거와 하단선을 맞춘다", () => {
    render(
      <CompactFilterToolbar
        primaryControls={<Text>주문 검색</Text>}
        secondaryFilters={<Text>조회 기간</Text>}
      />,
    );

    const toolbar = screen.getByRole("region", { name: "목록 필터" });
    expect(toolbar.style.justifyContent).toBe("flex-start");
    expect(toolbar.style.alignItems).toBe("flex-end");
    expect(toolbar.style.flexWrap).toBe("wrap");
    expect((toolbar.firstElementChild as HTMLElement).style.flex).toBe(
      "1 1 0%",
    );
    expect(screen.getByRole("button", { name: "필터" }).className).toContain(
      "h-10",
    );
  });

  it("검색이 없는 목록은 필터 트리거만 중앙에 표시한다", () => {
    render(<CompactFilterToolbar secondaryFilters={<Text>상태</Text>} />);

    expect(
      screen.getByRole("region", { name: "목록 필터" }).style.justifyContent,
    ).toBe("center");
    expect(screen.getByRole("button", { name: "필터" })).toBeTruthy();
  });

  it("핵심 필터만 표시하고 보조 필터가 없으면 필터 버튼을 숨긴다", () => {
    render(<CompactFilterToolbar primaryControls={<Text>주문 검색</Text>} />);

    expect(screen.getByText("주문 검색")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "필터" })).toBeNull();
  });

  it("null 보조 필터는 트리거와 dialog를 렌더링하지 않는다", () => {
    render(
      <CompactFilterToolbar
        primaryControls={<Text>주문 검색</Text>}
        secondaryFilters={null}
      />,
    );

    expect(screen.queryByRole("button", { name: "필터" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("활성 개수를 표시하고 보조 필터를 적용한다", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(
      <CompactFilterToolbar
        primaryControls={<Text>주문 검색</Text>}
        secondaryFilters={<Text>조회 기간</Text>}
        secondaryFilterCount={2}
        onOpenSecondaryFilters={onOpen}
        onApplySecondaryFilters={onApply}
        onCancelSecondaryFilters={onCancel}
      />,
    );

    const trigger = screen.getByRole("button", { name: "필터 2" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await user.click(trigger);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog", { name: "상세 필터" })).toBeTruthy();
    expect(screen.getByText("조회 기간")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "필터 적용" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("취소하면 초안 폐기 콜백을 실행한다", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <CompactFilterToolbar
        primaryControls={<Text>고객 검색</Text>}
        secondaryFilters={<Text>가입 기간</Text>}
        onCancelSecondaryFilters={onCancel}
      />,
    );

    const trigger = screen.getByRole("button", { name: "필터" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "취소" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("적용 콜백이 false를 반환하면 오류 수정을 위해 패널을 유지한다", async () => {
    const user = userEvent.setup();
    render(
      <CompactFilterToolbar
        primaryControls={<Text>상태</Text>}
        secondaryFilters={<Text>사용자 ID</Text>}
        onApplySecondaryFilters={() => false}
      />,
    );

    const trigger = screen.getByRole("button", { name: "필터" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "필터 적용" }));

    expect(screen.getByRole("dialog", { name: "상세 필터" })).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });
});

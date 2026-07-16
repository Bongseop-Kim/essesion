import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SubmittedMemorySearch } from "./submitted-memory-search";

describe("SubmittedMemorySearch", () => {
  it("검색 입력이 폼의 남는 폭을 채운다", () => {
    const { container } = render(
      <SubmittedMemorySearch
        label="고객 검색"
        placeholder="2자 이상 입력"
        maxLength={100}
        onSubmit={vi.fn()}
      />,
    );

    const form = container.querySelector("form");
    expect(form?.style.width).toBe("100%");
    expect((form?.firstElementChild as HTMLElement).style.flex).toBe("1 1 0%");
  });

  it("외부 초기화 신호가 입력과 제출 상태를 함께 지운다", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <SubmittedMemorySearch
        label="고객 검색"
        placeholder="2자 이상 입력"
        maxLength={100}
        resetKey={0}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByLabelText("고객 검색"), "홍길동");
    await user.click(screen.getByRole("button", { name: "검색" }));
    expect(onSubmit).toHaveBeenCalledWith("홍길동");
    expect(screen.getByRole("button", { name: "검색 초기화" })).toBeTruthy();

    rerender(
      <SubmittedMemorySearch
        label="고객 검색"
        placeholder="2자 이상 입력"
        maxLength={100}
        resetKey={1}
        onSubmit={onSubmit}
      />,
    );

    expect((screen.getByLabelText("고객 검색") as HTMLInputElement).value).toBe(
      "",
    );
    expect(screen.queryByRole("button", { name: "검색 초기화" })).toBeNull();
  });

  it("사용자 정의 검증에 실패하면 검색을 제출하지 않는다", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <SubmittedMemorySearch
        label="작업 ID 검색"
        placeholder="정확한 작업 ID 입력"
        maxLength={36}
        validate={(value) =>
          value === "valid-id" ? undefined : "작업 ID 형식이 올바르지 않습니다."
        }
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByLabelText("작업 ID 검색"), "invalid");
    await user.click(screen.getByRole("button", { name: "검색" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("작업 ID 형식이 올바르지 않습니다.")).toBeTruthy();
  });
});

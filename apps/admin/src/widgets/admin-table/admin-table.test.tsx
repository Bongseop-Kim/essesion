import { Text } from "@essesion/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AdminTable, type AdminTableColumn } from "./admin-table";

type Row = { id: string; amount: number };

const columns: readonly AdminTableColumn<Row>[] = [
  {
    key: "id",
    header: "주문 번호",
    sortable: true,
    render: (row) => (
      <Text as="span" textStyle="bodySm">
        {row.id}
      </Text>
    ),
  },
  {
    key: "amount",
    header: "금액",
    align: "end",
    visibility: "medium",
    render: (row) => (
      <Text as="span" textStyle="bodySm">
        {row.amount}
      </Text>
    ),
  },
];

describe("AdminTable", () => {
  it("native table·caption·sort semantics를 제공한다", async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    render(
      <AdminTable
        label="주문 목록"
        columns={columns}
        rows={[{ id: "ORDER-1", amount: 10000 }]}
        getRowKey={(row) => row.id}
        status="success"
        total={1}
        sort={{ key: "id", direction: "asc" }}
        onSort={onSort}
      />,
    );

    expect(screen.getByRole("table", { name: "주문 목록" })).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "주문 목록 표 가로 스크롤 영역" })
        .tabIndex,
    ).toBe(0);
    expect(
      screen
        .getByRole("columnheader", { name: "주문 번호" })
        .getAttribute("aria-sort"),
    ).toBe("ascending");

    await user.click(screen.getByRole("button", { name: "주문 번호 정렬" }));
    expect(onSort).toHaveBeenCalledWith({ key: "id", direction: "desc" });
  });

  it("loading·empty·error 상태를 서로 다른 문구로 표시한다", () => {
    const { rerender } = render(
      <AdminTable
        label="주문 목록"
        columns={columns}
        getRowKey={(row) => row.id}
        status="loading"
      />,
    );
    expect(screen.getByText("주문 목록 불러오는 중")).toBeTruthy();

    rerender(
      <AdminTable
        label="주문 목록"
        columns={columns}
        rows={[]}
        getRowKey={(row) => row.id}
        status="success"
        emptyTitle="검색 결과가 없습니다"
      />,
    );
    expect(screen.getByText("검색 결과가 없습니다")).toBeTruthy();

    rerender(
      <AdminTable
        label="주문 목록"
        columns={columns}
        getRowKey={(row) => row.id}
        status="error"
      />,
    );
    expect(screen.getByText("목록을 불러오지 못했습니다")).toBeTruthy();
  });
});

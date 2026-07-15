import { Text } from "@essesion/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaginatedAdminTableCard } from "./paginated-admin-table-card";

type Row = { id: string };

const columns = [
  {
    key: "id",
    header: "주문 번호",
    render: (row: Row) => <Text>{row.id}</Text>,
  },
] as const;

const baseProps = {
  title: "주문 목록",
  label: "주문 목록",
  columns,
  rows: [{ id: "ORDER-1" }],
  getRowKey: (row: Row) => row.id,
  total: 347,
  limit: 20,
  refreshing: false,
  onRefresh: vi.fn(),
  page: 1,
  totalPages: 18,
  onPageChange: vi.fn(),
  paginationLabel: "주문 목록 페이지",
} as const;

describe("PaginatedAdminTableCard", () => {
  it("성공한 목록에만 현재 범위와 페이지 크기를 표시한다", () => {
    const { rerender } = render(
      <PaginatedAdminTableCard
        {...baseProps}
        description="총 0건"
        status="loading"
      />,
    );

    expect(screen.getByText("주문 목록 불러오는 중")).toBeTruthy();
    expect(screen.queryByText("총 0건")).toBeNull();
    expect(screen.queryByText("페이지당 20개")).toBeNull();
    expect(
      screen.queryByRole("navigation", { name: "주문 목록 페이지" }),
    ).toBeNull();

    rerender(<PaginatedAdminTableCard {...baseProps} status="success" />);

    expect(screen.getByText("1–20 / 총 347건")).toBeTruthy();
    expect(screen.getByText("페이지당 20개")).toBeTruthy();
    expect(
      screen.getByRole("navigation", { name: "주문 목록 페이지" }),
    ).toBeTruthy();
  });

  it("툴바 슬롯을 목록 표 위에 배치한다", () => {
    render(
      <PaginatedAdminTableCard
        {...baseProps}
        status="success"
        toolbar={<Text>주문 필터 도구</Text>}
      />,
    );

    const toolbar = screen.getByText("주문 필터 도구");
    const table = screen.getByRole("table", { name: "주문 목록" });

    expect(
      toolbar.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

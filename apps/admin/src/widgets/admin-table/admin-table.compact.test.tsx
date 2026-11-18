import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { AdminTable } from "./admin-table";

vi.mock("@essesion/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@essesion/shared")>()),
  useBreakpoint: () => "base",
}));

it("md 미만 두 줄 목록에도 정렬 버튼과 결과 알림 영역을 남긴다", async () => {
  const onSort = vi.fn();
  render(
    <AdminTable
      label="주문 목록"
      columns={[
        { key: "id", header: "주문 번호", sortable: true, render: (r) => r.id },
        { key: "amount", header: "금액", render: (r) => r.amount },
      ]}
      rows={[{ id: "ORDER-1", amount: 1000 }]}
      getRowKey={(row) => row.id}
      compactRow={(row) => ({ title: row.id, trailing: row.amount })}
      status="success"
      sort={{ key: "id", direction: "asc" }}
      onSort={onSort}
    />,
  );

  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.getByRole("list", { name: "주문 목록" })).toBeTruthy();
  expect(screen.getByText("총 1건")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "주문 번호 정렬" }));
  expect(onSort).toHaveBeenCalledWith({ key: "id", direction: "desc" });
});

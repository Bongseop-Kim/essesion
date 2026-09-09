import type { ManualOrderOut } from "@essesion/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({
  getOrder: vi.fn(),
  deleteOrder: vi.fn(),
  createImageReadUrl: vi.fn(),
  patchStatus: vi.fn(),
}));

vi.mock("@essesion/api-client/query", () => ({
  getManualOrderOptions: (_options: unknown) => ({
    queryKey: ["manual-order"],
    queryFn: api.getOrder,
  }),
  getManualOrderQueryKey: () => ["manual-order"],
  deleteManualOrderMutation: () => ({ mutationFn: api.deleteOrder }),
  createManualOrderImageReadUrlMutation: () => ({
    mutationFn: api.createImageReadUrl,
  }),
  patchManualOrderStatusMutation: () => ({ mutationFn: api.patchStatus }),
  listManualOrdersQueryKey: () => ["manual-orders"],
}));

import { ManualRepairDetailPage } from "./detail";

const order: ManualOrderOut = {
  id: "manual-order-1",
  order_date: "2026-07-15",
  customer_name: "홍길동",
  phone: "01012345678",
  address: null,
  amount: 30_000,
  discount: 0,
  shipping_fee: 0,
  is_received: true,
  is_paid: false,
  is_confirmed: false,
  items: [
    {
      quantity: 1,
      automatic: {
        mechanism: "zipper",
        turn_knot: true,
        dimple: true,
        total_length_cm: 51,
        wearer_height_cm: 175,
      },
      width: null,
      restoration: null,
      custom: null,
      note: "",
      image_upload_ids: [],
    },
  ],
  images: [],
  created_at: "2026-07-15T01:00:00Z",
  updated_at: "2026-07-15T01:00:00Z",
};

function renderPage() {
  renderAdminPage(
    <Routes>
      <Route
        path="/manual-orders/repairs/:manualOrderId"
        element={<ManualRepairDetailPage />}
      />
    </Routes>,
    { entry: `/manual-orders/repairs/${order.id}` },
  );
}

describe("ManualRepairDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getOrder.mockResolvedValue(order);
  });

  it("확인 처리 클릭 시 상태 patch mutation을 호출하고 자동수선 키·넥타이 길이를 표시한다", async () => {
    const user = userEvent.setup();
    api.patchStatus.mockResolvedValue({ ...order, is_confirmed: true });
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "홍길동 님의 수기 수선" }),
    ).toBeTruthy();
    expect(screen.getByText("[자동] 키")).toBeTruthy();
    expect(screen.getByText("175cm")).toBeTruthy();
    expect(screen.getByText("[자동] 넥타이 길이")).toBeTruthy();
    expect(screen.getByText("51cm")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "확인 처리" }));

    await waitFor(() =>
      expect(api.patchStatus).toHaveBeenCalledWith(
        {
          path: { manual_order_id: order.id },
          body: {
            is_confirmed: true,
            expected_updated_at: order.updated_at,
          },
        },
        expect.anything(),
      ),
    );
  });
});

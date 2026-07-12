import type { AdminOrderDetailOut } from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getOrder: vi.fn(),
  getReferenceImages: vi.fn(),
  getReferenceImagesOptions: vi.fn(),
  createReferenceImageReadUrl: vi.fn(),
  updateStatus: vi.fn(),
  updateTracking: vi.fn(),
}));

vi.mock("@essesion/api-client/query", () => ({
  getAdminOrderOptions: (_options: unknown) => ({
    queryKey: ["order"],
    queryFn: api.getOrder,
  }),
  getAdminOrderQueryKey: (_options: unknown) => ["order"],
  listAdminOrderReferenceImagesOptions: (options: unknown) => {
    api.getReferenceImagesOptions(options);
    return {
      queryKey: ["order-reference-images"],
      queryFn: api.getReferenceImages,
    };
  },
  createAdminOrderReferenceImageReadUrlMutation: () => ({
    mutationFn: api.createReferenceImageReadUrl,
  }),
  listAllOrdersQueryKey: () => ["orders"],
  adminUpdateOrderStatusMutation: () => ({ mutationFn: api.updateStatus }),
  adminUpdateOrderTrackingMutation: () => ({
    mutationFn: api.updateTracking,
  }),
}));

import { OrderDetailPage } from "./detail";

const order: AdminOrderDetailOut = {
  id: "order-1",
  order_number: "ORDER-001",
  order_type: "sale",
  order_amount: 50_000,
  original_price: 50_000,
  total_discount: 0,
  shipping_cost: 0,
  payment_group_id: "payment-1",
  status: "진행중",
  created_at: "2026-07-12T01:00:00Z",
  updated_at: "2026-07-12T01:00:00Z",
  confirmed_at: null,
  shipped_at: null,
  delivered_at: null,
  shipping_address_id: null,
  shipping_address: null,
  courier_company: null,
  tracking_number: null,
  company_courier_company: null,
  company_tracking_number: null,
  company_shipped_at: null,
  customer: {
    id: "customer-1",
    name: "홍길동",
    email: "customer@example.com",
    phone: null,
  },
  items: [
    {
      id: "item-1",
      item_id: "sku-1",
      item_type: "product",
      item_data: { product_snapshot: { name: "테스트 상품" } },
      product_id: 1,
      selected_option_id: null,
      applied_user_coupon_id: null,
      quantity: 1,
      unit_price: 50_000,
      discount_amount: 0,
      line_discount_amount: 0,
    },
  ],
  active_claim: null,
  related_orders: [],
  status_logs: [],
  admin_actions: [
    {
      kind: "advance",
      label: "배송 시작",
      target_status: "배송중",
      enabled: true,
      requires_memo: true,
    },
  ],
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/orders/order-1"]}>
        <Routes>
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("OrderDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getReferenceImages.mockResolvedValue([]);
  });

  it("오류에서 다시 시도해 상세 heading과 native item table을 복구한다", async () => {
    const user = userEvent.setup();
    api.getOrder
      .mockRejectedValueOnce(new Error("상세 오류"))
      .mockResolvedValueOnce(order);
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "주문 상세", level: 1 }),
    ).toBeTruthy();
    expect(await screen.findByText("주문을 불러오지 못했습니다")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(
      await screen.findByRole("heading", { name: "주문 ORDER-001", level: 1 }),
    ).toBeTruthy();
    expect(screen.getByRole("table", { name: "주문 항목" })).toBeTruthy();
    expect(
      screen.getByRole("columnheader", { name: "거래 시점 상품·옵션" }),
    ).toBeTruthy();
    expect(api.getOrder).toHaveBeenCalledTimes(2);
  });

  it("pending 중 중복 작업을 막고 실패 뒤에도 입력을 보존한다", async () => {
    const user = userEvent.setup();
    let rejectMutation: ((error: Error) => void) | undefined;
    api.getOrder.mockResolvedValue(order);
    api.updateStatus.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectMutation = reject;
      }),
    );
    renderPage();

    await user.click(await screen.findByRole("button", { name: "배송 시작" }));
    const memo = screen.getByLabelText("변경 사유 (필수)");
    await user.type(memo, "출고 검수 완료");
    await user.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(api.updateStatus).toHaveBeenCalledTimes(1));
    expect(
      (screen.getByRole("button", { name: "취소" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "배송 시작" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await act(async () => rejectMutation?.(new Error("상태 충돌")));

    expect(await screen.findByText("상태 충돌")).toBeTruthy();
    expect((memo as HTMLTextAreaElement).value).toBe("출고 검수 완료");
  });

  it("성공 시 상세·목록 쿼리를 무효화하고 편집 입력을 초기화한다", async () => {
    const user = userEvent.setup();
    api.getOrder.mockResolvedValue(order);
    api.updateStatus.mockResolvedValue({
      success: true,
      previous_status: "진행중",
      new_status: "배송중",
    });
    const queryClient = renderPage();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await user.click(await screen.findByRole("button", { name: "배송 시작" }));
    await user.type(
      screen.getByLabelText("변경 사유 (필수)"),
      "출고 검수 완료",
    );
    await user.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["order"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["orders"] });
    });
    expect(screen.queryByLabelText("변경 사유 (필수)")).toBeNull();
  });

  it("맞춤 주문은 허용된 요약과 관계형 이미지 URL만 표시·재발급한다", async () => {
    const user = userEvent.setup();
    api.getOrder.mockResolvedValue({
      ...order,
      order_type: "custom",
      items: [
        {
          ...order.items?.[0],
          item_type: "custom_order",
          item_data: {
            options: {
              fabric_type: "SILK",
              tie_type: "AUTO",
              object_key: "uploads/custom_order/private-option.png",
            },
            additional_notes: "광택을 낮춰 주세요.",
            object_key: "uploads/custom_order/private-root.png",
            reference_images: [
              { object_key: "uploads/custom_order/private-list.png" },
            ],
          },
        },
      ],
    });
    api.getReferenceImages.mockResolvedValue([
      {
        id: "11111111-1111-4111-8111-111111111111",
        content_type: "image/png",
        size_bytes: 2_048,
        created_at: "2026-07-12T01:00:00Z",
      },
    ]);
    api.createReferenceImageReadUrl
      .mockResolvedValueOnce({ read_url: "https://storage.test/signed-1" })
      .mockResolvedValueOnce({ read_url: "https://storage.test/signed-2" });
    renderPage();

    expect(await screen.findByText("맞춤 제작")).toBeTruthy();
    expect(screen.getByText(/원단: SILK/)).toBeTruthy();
    expect(screen.getByText("광택을 낮춰 주세요.")).toBeTruthy();
    expect(api.getReferenceImagesOptions).toHaveBeenCalledWith({
      path: { order_id: order.id },
    });
    expect(document.body.textContent).not.toContain("uploads/custom_order");

    await user.click(
      await screen.findByRole("button", { name: "이미지 보기" }),
    );
    const image = await screen.findByRole("img", {
      name: "주문 참고 이미지 1",
    });
    expect(image.getAttribute("src")).toBe("https://storage.test/signed-1");
    expect(api.createReferenceImageReadUrl).toHaveBeenCalledWith(
      {
        path: {
          order_id: order.id,
          image_id: "11111111-1111-4111-8111-111111111111",
        },
      },
      expect.anything(),
    );
    expect(document.body.textContent).not.toContain("https://storage.test");

    await user.click(screen.getByRole("button", { name: "URL 재발급" }));
    await waitFor(() =>
      expect(api.createReferenceImageReadUrl).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(image.getAttribute("src")).toBe("https://storage.test/signed-2"),
    );
  });

  it("샘플 주문 유형을 거래 시점 데이터로 요약한다", async () => {
    api.getOrder.mockResolvedValue({
      ...order,
      order_type: "sample",
      items: [
        {
          ...order.items?.[0],
          item_type: "sample_order",
          item_data: {
            sample_type: "fabric_and_sewing",
            options: { fabric_type: "POLY", interlining: "WOOL" },
          },
        },
      ],
    });
    renderPage();

    expect(await screen.findByText("원단 + 봉제 샘플")).toBeTruthy();
    expect(screen.getByText(/원단: POLY/)).toBeTruthy();
    expect(
      await screen.findByText("등록된 참고 이미지가 없습니다."),
    ).toBeTruthy();
  });
});

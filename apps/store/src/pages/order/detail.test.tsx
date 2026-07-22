// @vitest-environment jsdom

import type { OrderDetailOut } from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  detail: vi.fn(),
  confirm: vi.fn(),
  referenceImages: vi.fn(),
  referenceReadUrl: vi.fn(),
  receiptPhotos: vi.fn(),
  receiptReadUrl: vi.fn(),
  readUrl: vi.fn(),
  createReview: vi.fn(),
  updateReview: vi.fn(),
  deleteReview: vi.fn(),
  review: vi.fn(),
}));

vi.mock("@essesion/api-client", () => ({
  createMyOrderReferenceImageReadUrl: api.referenceReadUrl,
  createMyRepairReceiptPhotoReadUrl: api.receiptReadUrl,
  createReadUrl: api.readUrl,
}));

vi.mock("@essesion/api-client/query", () => ({
  getOrderOptions: () => ({ queryKey: ["order"], queryFn: api.detail }),
  getOrderQueryKey: () => ["order"],
  listMyOrdersQueryKey: () => ["orders"],
  listMyOrderReferenceImagesOptions: () => ({
    queryKey: ["order-reference-images"],
    queryFn: api.referenceImages,
  }),
  listMyRepairReceiptPhotosOptions: () => ({
    queryKey: ["repair-receipt-photos"],
    queryFn: api.receiptPhotos,
  }),
  confirmPurchaseMutation: () => ({ mutationFn: api.confirm }),
  createReviewMutation: () => ({ mutationFn: api.createReview }),
  updateReviewMutation: () => ({ mutationFn: api.updateReview }),
  deleteReviewMutation: () => ({ mutationFn: api.deleteReview }),
  getReviewOptions: () => ({ queryKey: ["review"], queryFn: api.review }),
  getReviewQueryKey: () => ["review"],
  listReviewsQueryKey: () => ["reviews"],
}));

import { OrderDetailPage } from "./detail";

const order: OrderDetailOut = {
  id: "order-1",
  order_number: "ORD-001",
  order_type: "sale",
  status: "진행중",
  total_price: 10_000,
  original_price: 10_000,
  total_discount: 0,
  shipping_cost: 0,
  payment_group_id: "payment-1",
  shipping_address_id: null,
  courier_company: null,
  tracking_number: null,
  shipped_at: null,
  delivered_at: null,
  confirmed_at: null,
  company_courier_company: null,
  company_tracking_number: null,
  company_shipped_at: null,
  created_at: "2026-07-15T01:00:00Z",
  updated_at: "2026-07-15T01:00:00Z",
  customer_actions: ["claim_cancel"],
  shipping_address: null,
  claim_summary: {
    claim_number: "CLM-001",
    type: "cancel",
    status: "완료",
  },
  items: [
    {
      id: "item-1",
      item_id: "product-1",
      item_type: "product",
      product_id: 1,
      selected_option_id: null,
      item_data: {},
      quantity: 1,
      unit_price: 10_000,
      discount_amount: 0,
      line_discount_amount: 0,
      applied_user_coupon_id: null,
      claim: {
        claim_number: "CLM-001",
        type: "cancel",
        status: "완료",
      },
    },
  ],
};

describe("OrderDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.detail.mockResolvedValue(order);
    api.referenceImages.mockResolvedValue([]);
    api.receiptPhotos.mockResolvedValue([]);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <MemoryRouter initialEntries={["/order/order-1"]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/order/:orderId" element={<OrderDetailPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it("완료된 취소를 표시하고 같은 항목의 취소 요청을 숨긴다", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "ORD-001", level: 1 }),
    ).toBeTruthy();
    expect(screen.getAllByText("취소 완료")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "취소 요청" })).toBeNull();
  });

  it("맞춤 사양의 미지 옵션과 참고 이미지를 표시한다", async () => {
    api.detail.mockResolvedValue({
      ...order,
      order_type: "custom",
      items: [
        {
          ...order.items?.[0],
          item_type: "custom",
          quantity: 4,
          item_data: {
            options: {
              fabric_type: "SILK",
              triangle_stitch: true,
              lining_color: "navy",
            },
            additional_notes: "광택을 낮춰 주세요.",
          },
        },
      ],
    });
    api.referenceImages.mockResolvedValue([
      {
        id: "image-1",
        content_type: "image/png",
        size_bytes: 100,
        created_at: "2026-07-15T01:00:00Z",
      },
    ]);
    api.referenceReadUrl.mockResolvedValue({
      data: { read_url: "https://storage.test/custom.png" },
    });
    renderPage();

    expect(await screen.findByText("lining color")).toBeTruthy();
    expect(screen.getByText("navy")).toBeTruthy();
    expect(screen.getByText("삼각 봉제")).toBeTruthy();
    expect(screen.getByText("광택을 낮춰 주세요.")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "이미지 보기" }));
    expect(
      (
        await screen.findByRole("img", { name: "주문 참고 이미지 1" })
      ).getAttribute("src"),
    ).toBe("https://storage.test/custom.png");
  });

  it("수선 사양과 수거·발송 접수 사진을 되읽는다", async () => {
    api.detail.mockResolvedValue({
      ...order,
      order_type: "repair",
      repair_pickup: {
        id: "pickup-1",
        recipient_name: "수거 고객",
        recipient_phone: "01012345678",
        postal_code: "04524",
        address: "서울시 중구",
        detail_address: "101호",
        pickup_fee: 5000,
        created_at: "2026-07-15T01:00:00Z",
      },
      repair_receipts: [
        {
          id: "receipt-1",
          receipt_type: "no_tracking",
          reason: "lost",
          memo: "송장을 분실했습니다.",
          photo_count: 1,
          created_at: "2026-07-15T02:00:00Z",
        },
      ],
      items: [
        {
          ...order.items?.[0],
          item_type: "reform",
          item_data: {
            tie: {
              image: { object_key: "uploads/reform_upload/tie.png" },
              automatic: {
                mechanism: "zipper",
                wearer_height_cm: 175,
                dimple: true,
                turn_knot: false,
              },
              width: { target_width_cm: 7.5 },
              restoration: { memo: "원형을 유지해 주세요." },
            },
          },
        },
      ],
    });
    api.receiptPhotos.mockResolvedValue([
      {
        id: "photo-1",
        content_type: "image/png",
        size_bytes: 100,
        created_at: "2026-07-15T02:00:00Z",
      },
    ]);
    api.readUrl.mockResolvedValue({
      data: { read_url: "https://storage.test/tie.png" },
    });
    api.receiptReadUrl.mockResolvedValue({
      data: { read_url: "https://storage.test/receipt.png" },
    });
    renderPage();

    expect(await screen.findByText("자동 타이 방식")).toBeTruthy();
    expect(screen.getByText("175cm")).toBeTruthy();
    expect(screen.getByText("원형을 유지해 주세요.")).toBeTruthy();
    expect(screen.getByText("수거 고객 · 01012345678")).toBeTruthy();
    expect(screen.getByText("송장 분실")).toBeTruthy();
    expect(screen.getByText("송장을 분실했습니다.")).toBeTruthy();

    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "이미지 보기" }),
      ).toHaveLength(2),
    );
    const imageButtons = screen.getAllByRole("button", { name: "이미지 보기" });
    fireEvent.click(imageButtons[0] as HTMLElement);
    fireEvent.click(imageButtons[1] as HTMLElement);
    expect(
      (await screen.findByRole("img", { name: "수선 접수 사진" })).getAttribute(
        "src",
      ),
    ).toBe("https://storage.test/tie.png");
    expect(
      (
        await screen.findByRole("img", { name: "수선 발송 사진 1" })
      ).getAttribute("src"),
    ).toBe("https://storage.test/receipt.png");
  });

  it("수선 발송 사진 조회 실패 후 다시 시도한다", async () => {
    api.detail.mockResolvedValue({
      ...order,
      order_type: "repair",
      repair_receipts: [
        {
          id: "receipt-1",
          receipt_type: "tracking",
          reason: null,
          memo: null,
          photo_count: 1,
          created_at: "2026-07-15T02:00:00Z",
        },
      ],
      items: [],
    });
    api.receiptPhotos
      .mockRejectedValueOnce(new Error("사진 조회 실패"))
      .mockResolvedValueOnce([
        {
          id: "photo-1",
          content_type: "image/png",
          size_bytes: 100,
          created_at: "2026-07-15T02:00:00Z",
        },
      ]);
    renderPage();

    expect(
      await screen.findByText("발송 사진을 불러오지 못했습니다"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    await waitFor(() => expect(api.receiptPhotos).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("button", { name: "이미지 보기" }),
    ).toBeTruthy();
  });
});

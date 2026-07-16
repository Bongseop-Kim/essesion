import type { AdminOrderDetailOut } from "@essesion/api-client";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({
  getOrder: vi.fn(),
  getReferenceImages: vi.fn(),
  getReferenceImagesOptions: vi.fn(),
  getRepairReceiptPhotos: vi.fn(),
  getRepairReceiptPhotosOptions: vi.fn(),
  createReferenceImageReadUrl: vi.fn(),
  createRepairReceiptPhotoReadUrl: vi.fn(),
  updateStatus: vi.fn(),
  updateTracking: vi.fn(),
}));
const blocker = vi.hoisted(() => ({
  state: "unblocked",
  proceed: vi.fn(),
  reset: vi.fn(),
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
  listAdminRepairReceiptPhotosOptions: (options: {
    path: { receipt_id: string };
  }) => {
    api.getRepairReceiptPhotosOptions(options);
    return {
      queryKey: ["repair-receipt-photos", options.path.receipt_id],
      queryFn: () => api.getRepairReceiptPhotos(options),
    };
  },
  createAdminRepairReceiptPhotoReadUrlMutation: () => ({
    mutationFn: api.createRepairReceiptPhotoReadUrl,
  }),
  listAllOrdersQueryKey: () => ["orders"],
  adminUpdateOrderStatusMutation: () => ({ mutationFn: api.updateStatus }),
  adminUpdateOrderTrackingMutation: () => ({
    mutationFn: api.updateTracking,
  }),
}));

vi.mock("../../shared/lib/use-dirty-form-blocker", () => ({
  useDirtyFormBlocker: () => blocker,
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
  claim_summary: {
    claim_number: "CLM-001",
    type: "cancel",
    status: "처리중",
  },
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
      claim: {
        claim_number: "CLM-001",
        type: "cancel",
        status: "처리중",
      },
    },
  ],
  active_claim: {
    id: "claim-1",
    claim_number: "CLM-001",
    type: "cancel",
    status: "처리중",
    reason: "change_mind",
    description: null,
    quantity: 1,
    created_at: "2026-07-12T01:00:00Z",
  },
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

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

function renderPage(entry = "/orders/order-1") {
  const { queryClient } = renderAdminPage(
    <Routes>
      <Route
        path="/orders/:orderId"
        element={
          <>
            <OrderDetailPage />
            <LocationProbe />
          </>
        }
      />
    </Routes>,
    { entry },
  );
  return queryClient;
}

describe("OrderDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blocker.state = "unblocked";
    api.getReferenceImages.mockResolvedValue([]);
    api.getRepairReceiptPhotos.mockResolvedValue([]);
  });

  it("첫 화면에 주문 요약과 액션을 두고 탭 선택을 URL과 접근성 상태에 반영한다", async () => {
    const user = userEvent.setup();
    api.getOrder.mockResolvedValue(order);
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "주문 ORDER-001", level: 1 }),
    ).toBeTruthy();
    expect(screen.getByText(/홍길동.*₩50,000.*마지막 변경/)).toBeTruthy();
    const tablist = screen.getByRole("tablist", { name: "주문 상세 메뉴" });
    expect(within(tablist).getAllByRole("tab")).toHaveLength(5);
    expect(
      screen.getByRole("tab", { name: "개요" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "개요" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "배송 시작" })).toBeTruthy();
    expect(screen.queryByRole("table", { name: "주문 항목" })).toBeNull();

    await user.click(screen.getByRole("tab", { name: "항목" }));

    expect(screen.getByTestId("location-search").textContent).toBe(
      "?tab=items",
    );
    expect(
      screen.getByRole("tab", { name: "항목" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "항목" })).toBeTruthy();
    expect(screen.getByRole("table", { name: "주문 항목" })).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "개요" }));
    expect(screen.getByTestId("location-search").textContent).toBe("");
    expect(screen.getByRole("button", { name: "배송 시작" })).toBeTruthy();
  });

  it("활동 이력 딥링크를 복원하고 토큰 주문에는 불필요한 배송·수선 탭을 숨긴다", async () => {
    api.getOrder.mockResolvedValue({
      ...order,
      order_type: "token",
      claim_summary: null,
      active_claim: null,
      admin_actions: [],
    });
    renderPage("/orders/order-1?tab=activity");

    await screen.findByRole("heading", { name: "주문 ORDER-001", level: 1 });
    expect(
      screen
        .getByRole("tab", { name: "활동 이력" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "활동 이력" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "배송·수선" })).toBeNull();
    expect(screen.getByText("기록된 상태 변경이 없습니다.")).toBeTruthy();
  });

  it("기술 식별자는 기본으로 접고 이력 처리자는 의미 라벨로 표시한다", async () => {
    const user = userEvent.setup();
    const paymentGroupId = "11111111-1111-4111-8111-111111111111";
    const actorId = "22222222-2222-4222-8222-222222222222";
    const itemId = "33333333-3333-4333-8333-333333333333";
    api.getOrder.mockResolvedValue({
      ...order,
      payment_group_id: paymentGroupId,
      items: (order.items ?? []).map((item) => ({
        ...item,
        item_id: itemId,
        item_data: {},
      })),
      status_logs: [
        {
          id: "admin-log-1",
          previous_status: "진행중",
          new_status: "배송중",
          memo: "출고 완료",
          is_rollback: false,
          changed_by: actorId,
          created_at: "2026-07-12T02:00:00Z",
        },
        {
          id: "system-log-1",
          previous_status: "결제중",
          new_status: "진행중",
          memo: null,
          is_rollback: false,
          changed_by: null,
          created_at: "2026-07-12T01:30:00Z",
        },
      ],
    });
    renderPage("/orders/order-1?tab=payment");

    await screen.findByRole("heading", { name: "주문 ORDER-001", level: 1 });
    let trigger = screen.getByRole("button", { name: "기술 정보" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "기술 정보" })).toBeNull();
    expect(screen.queryByRole("button", { name: "기술 정보 복사" })).toBeNull();

    await user.click(trigger);
    expect(
      within(screen.getByRole("region", { name: "기술 정보" })).getByText(
        new RegExp(paymentGroupId),
      ),
    ).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "활동 이력" }));
    expect(screen.getByText(/처리자 관리자/)).toBeTruthy();
    expect(screen.getByText(/처리자 시스템/)).toBeTruthy();
    trigger = screen.getByRole("button", { name: "기술 정보" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "기술 정보" })).toBeNull();
    await user.click(trigger);
    expect(
      within(screen.getByRole("region", { name: "기술 정보" })).getByText(
        new RegExp(actorId),
      ),
    ).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "항목" }));
    expect(screen.getByText("상품 정보 없음")).toBeTruthy();
    trigger = screen.getByRole("button", { name: "기술 정보" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "기술 정보" })).toBeNull();
    await user.click(trigger);
    expect(
      within(screen.getByRole("region", { name: "기술 정보" })).getByText(
        new RegExp(itemId),
      ),
    ).toBeTruthy();
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
    expect(screen.getByRole("button", { name: "배송 시작" })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "항목" }));
    expect(screen.getByRole("table", { name: "주문 항목" })).toBeTruthy();
    expect(
      screen.getByRole("columnheader", { name: "거래 시점 상품·옵션" }),
    ).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "클레임" })).toBeTruthy();
    expect(screen.getAllByText("취소 처리중")).toHaveLength(2);
    expect(screen.getByText("활성 클레임 CLM-001")).toBeTruthy();
    expect(api.getOrder).toHaveBeenCalledTimes(2);
  });

  it("완료된 취소를 표시하고 차단된 운영 액션의 이유를 안내한다", async () => {
    const user = userEvent.setup();
    api.getOrder.mockResolvedValue({
      ...order,
      claim_summary: { ...order.claim_summary!, status: "완료" },
      active_claim: null,
      items: (order.items ?? []).map((item) => ({
        ...item,
        claim: item.claim ? { ...item.claim, status: "완료" } : null,
      })),
      admin_actions: [
        {
          kind: "advance",
          label: "배송중 상태로 진행",
          target_status: "배송중",
          enabled: false,
          blocking_reason:
            "취소 클레임이 완료되어 주문 상태를 변경할 수 없습니다",
        },
        {
          kind: "update_tracking",
          label: "송장 정보 수정",
          enabled: false,
          blocking_reason: "취소 클레임이 완료되어 송장을 수정할 수 없습니다",
        },
      ],
    });
    renderPage();

    expect(await screen.findAllByText("취소 완료")).toHaveLength(1);
    expect(
      (
        screen.getByRole("button", {
          name: "배송중 상태로 진행",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "송장 정보 수정",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText(
        "배송중 상태로 진행: 취소 클레임이 완료되어 주문 상태를 변경할 수 없습니다",
      ),
    ).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "항목" }));
    expect(screen.getAllByText("취소 완료")).toHaveLength(2);
  });

  it("pending 중 중복 작업을 막고 실패 뒤에도 입력을 보존한다", async () => {
    const user = userEvent.setup();
    let rejectMutation: ((error: Error) => void) | undefined;
    api.getOrder.mockResolvedValue({
      ...order,
      admin_actions: [
        ...(order.admin_actions ?? []),
        {
          kind: "update_tracking",
          label: "송장 정보 수정",
          enabled: true,
        },
      ],
    });
    api.updateStatus.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectMutation = reject;
      }),
    );
    renderPage();

    await user.click(await screen.findByRole("button", { name: "배송 시작" }));
    expect(
      (screen.getByRole("tab", { name: "항목" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("현재 작업을 먼저 완료해 주세요")).toBeTruthy();
    const memo = screen.getByLabelText("변경 사유 (필수)");
    await user.type(memo, "출고 검수 완료");
    expect(
      (
        screen.getByRole("button", {
          name: "송장 정보 수정",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect((memo as HTMLTextAreaElement).value).toBe("출고 검수 완료");
    await user.click(screen.getByRole("button", { name: "배송 시작 적용" }));

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
    await user.click(screen.getByRole("button", { name: "배송 시작 적용" }));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["order"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["orders"] });
    });
    expect(screen.queryByLabelText("변경 사유 (필수)")).toBeNull();
  });

  it("이동 확인 후 작업 상태를 지우고 blocker를 진행한다", async () => {
    const user = userEvent.setup();
    api.getOrder.mockResolvedValue(order);
    blocker.proceed.mockImplementation(() => {
      blocker.state = "unblocked";
    });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "배송 시작" }));
    const memo = screen.getByLabelText("변경 사유 (필수)");
    await user.type(memo, "출고 검수");
    blocker.state = "blocked";
    await user.type(memo, " 완료");

    const dialog = await screen.findByRole("alertdialog", {
      name: "작성 중인 주문 작업을 버릴까요?",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "주문 작업 버리기" }),
    );

    expect(blocker.proceed).toHaveBeenCalledTimes(1);
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
              lining_color: "navy",
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

    await user.click(await screen.findByRole("tab", { name: "항목" }));
    expect(
      await screen.findByRole("heading", { name: /맞춤 제작$/ }),
    ).toBeTruthy();
    expect(screen.getByText("원단")).toBeTruthy();
    expect(screen.getByText("실크")).toBeTruthy();
    expect(screen.getByText("lining color")).toBeTruthy();
    expect(screen.getByText("navy")).toBeTruthy();
    expect(screen.getByText("광택을 낮춰 주세요.")).toBeTruthy();
    expect(api.getReferenceImagesOptions).toHaveBeenCalledWith({
      path: { order_id: order.id },
    });
    expect(document.body.textContent).not.toContain("uploads/custom_order");

    await user.click(screen.getByRole("tab", { name: "배송·수선" }));
    await user.click(
      await screen.findByRole("button", { name: "이미지 보기" }),
    );
    const image = await screen.findByRole("img", {
      name: "주문 첨부 이미지 1",
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
    const user = userEvent.setup();
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

    await user.click(await screen.findByRole("tab", { name: "항목" }));
    expect(
      await screen.findByRole("heading", { name: /원단 \+ 봉제 샘플$/ }),
    ).toBeTruthy();
    expect(screen.getByText("원단")).toBeTruthy();
    expect(screen.getByText("폴리")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "배송·수선" }));
    expect(
      await screen.findByText("등록된 첨부 이미지가 없습니다."),
    ).toBeTruthy();
  });

  it("수선 주문의 항목별 사양과 배송·수거·발송 정보를 모두 표시한다", async () => {
    const user = userEvent.setup();
    api.getOrder.mockResolvedValue({
      ...order,
      order_type: "repair",
      shipping_address_id: "address-1",
      shipping_address: {
        id: "address-1",
        recipient_name: "수령 고객",
        recipient_phone: "010-2222-3333",
        postal_code: "04524",
        address: "서울시 중구",
        address_detail: "202호",
        delivery_request: "경비실에 맡겨 주세요.",
        delivery_memo: "오후 배송 희망",
      },
      repair_pickup: {
        id: "pickup-1",
        recipient_name: "수거 고객",
        recipient_phone: "010-1111-2222",
        postal_code: "04524",
        address: "서울시 중구",
        detail_address: "101호",
        pickup_fee: 5_000,
        created_at: "2026-07-15T01:00:00Z",
      },
      repair_receipts: [
        {
          id: "receipt-1",
          receipt_type: "no_tracking",
          reason: "lost",
          memo: "송장을 분실했습니다.",
          photo_count: 2,
          created_at: "2026-07-15T02:00:00Z",
        },
      ],
      items: [
        {
          ...order.items?.[0],
          id: "repair-item-1",
          item_type: "reform",
          item_data: {
            tie: {
              automatic: {
                mechanism: "zipper",
                wearer_height_cm: 175,
                dimple: true,
              },
              width: { target_width_cm: 7.5 },
              restoration: { memo: "원형을 유지해 주세요." },
            },
          },
        },
        {
          ...order.items?.[0],
          id: "repair-item-2",
          item_id: "sku-2",
          item_type: "reform",
          item_data: {
            tie: {
              automatic: {
                mechanism: "string",
                wearer_height_cm: 182,
                turn_knot: true,
              },
            },
          },
        },
      ],
    });
    api.getRepairReceiptPhotos.mockResolvedValue([
      {
        id: "receipt-photo-1",
        content_type: "image/png",
        size_bytes: 1_024,
        created_at: "2026-07-15T02:00:00Z",
      },
    ]);
    api.createRepairReceiptPhotoReadUrl.mockResolvedValue({
      read_url: "https://storage.test/receipt-photo",
    });
    renderPage();

    expect(await screen.findByText("수선")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "배송·수선" }));
    expect(screen.getByText("010-2222-3333")).toBeTruthy();
    expect(screen.getByText("경비실에 맡겨 주세요.")).toBeTruthy();
    expect(screen.getByText("오후 배송 희망")).toBeTruthy();
    expect(screen.getByText("수거 고객 · 010-1111-2222")).toBeTruthy();
    expect(screen.getByText("송장 없이 발송")).toBeTruthy();
    expect(screen.getByText("송장 분실")).toBeTruthy();
    expect(screen.getByText("2장")).toBeTruthy();
    expect(screen.getByText("송장을 분실했습니다.")).toBeTruthy();
    expect(api.getReferenceImagesOptions).toHaveBeenCalledWith({
      path: { order_id: order.id },
    });
    expect(api.getRepairReceiptPhotosOptions).toHaveBeenCalledWith({
      path: { receipt_id: "receipt-1" },
    });

    await user.click(
      await screen.findByRole("button", { name: "이미지 보기" }),
    );
    expect(
      (
        await screen.findByRole("img", { name: "수선 발송 사진 1" })
      ).getAttribute("src"),
    ).toBe("https://storage.test/receipt-photo");
    expect(api.createRepairReceiptPhotoReadUrl).toHaveBeenCalledWith(
      {
        path: { receipt_id: "receipt-1", image_id: "receipt-photo-1" },
      },
      expect.anything(),
    );

    await user.click(screen.getByRole("tab", { name: "항목" }));
    expect(screen.getByText("175cm")).toBeTruthy();
    expect(screen.getByText("182cm")).toBeTruthy();
    expect(screen.getByText("원형을 유지해 주세요.")).toBeTruthy();
    expect(screen.getByText("딤플")).toBeTruthy();
    expect(screen.getByText("돌려묶기")).toBeTruthy();
  });
});

import type {
  AdminClaimDetailOut,
  AdminRepairPhotoOut,
  ClaimNotificationOut,
} from "@essesion/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({
  getClaim: vi.fn(),
  updateStatus: vi.fn(),
  updateTracking: vi.fn(),
  approveRefund: vi.fn(),
  retryNotification: vi.fn(),
  listPhotos: vi.fn(),
  createPhotoReadUrl: vi.fn(),
  photoListOptions: vi.fn(),
}));
const blocker = vi.hoisted(() => ({
  state: "unblocked",
  proceed: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("@essesion/api-client/query", () => ({
  adminGetClaimOptions: (_options: unknown) => ({
    queryKey: ["claim"],
    queryFn: api.getClaim,
  }),
  adminGetClaimQueryKey: (_options: unknown) => ["claim"],
  adminListClaimsV2QueryKey: () => ["claims"],
  adminUpdateClaimStatusMutation: () => ({ mutationFn: api.updateStatus }),
  adminUpdateClaimTrackingMutation: () => ({
    mutationFn: api.updateTracking,
  }),
  adminApproveTokenRefundMutation: () => ({ mutationFn: api.approveRefund }),
  adminRetryClaimNotificationMutation: () => ({
    mutationFn: api.retryNotification,
  }),
  listAdminRepairReceiptPhotosOptions: (options: unknown) => {
    api.photoListOptions(options);
    return {
      queryKey: ["repair-receipt-photos", JSON.stringify(options)],
      queryFn: api.listPhotos,
    };
  },
  createAdminRepairReceiptPhotoReadUrlMutation: () => ({
    mutationFn: api.createPhotoReadUrl,
  }),
}));

vi.mock("../../shared/lib/use-dirty-form-blocker", () => ({
  useDirtyFormBlocker: () => blocker,
}));

import { ClaimDetailPage } from "./detail";

const claim: AdminClaimDetailOut = {
  id: "claim-1",
  claim_number: "CL-2026-001",
  type: "return",
  status: "접수",
  reason: "defect",
  description: "원단 손상",
  quantity: 1,
  order_id: "order-1",
  order_number: "ORDER-001",
  created_at: "2026-07-12T01:00:00Z",
  updated_at: "2026-07-12T01:00:00Z",
  customer: {
    id: "customer-1",
    name: "홍길동",
    email: "customer@example.com",
    phone: "010-0000-0000",
  },
  order: {
    id: "order-1",
    order_number: "ORDER-001",
    order_type: "sale",
    status: "진행중",
    order_amount: 30_000,
    payment_group_id: "payment-group-1",
  },
  item: {
    id: "item-1",
    item_id: "sku-1",
    item_type: "product",
    item_data: null,
    product_id: 1,
    selected_option_id: null,
    applied_user_coupon_id: null,
    quantity: 1,
    unit_price: 30_000,
    discount_amount: 0,
    line_discount_amount: 0,
  },
  shipping: {
    shipping_address: null,
    order_courier_company: null,
    order_tracking_number: null,
    company_courier_company: null,
    company_tracking_number: null,
    return_courier_company: null,
    return_tracking_number: null,
    resend_courier_company: null,
    resend_tracking_number: null,
    repair_pickup: null,
    repair_receipts: [],
  },
  refund_data: null,
  status_logs: [],
  timeline: [],
  payment_incidents: [],
  notifications: [
    {
      id: "notification-1",
      status: "거부",
      delivery_status: "failed",
      attempts: 1,
      last_error: "발송 실패",
      sent_at: null,
      created_at: "2026-07-12T01:00:00Z",
      updated_at: "2026-07-12T01:01:00Z",
    },
  ],
  admin_actions: [
    {
      kind: "reject",
      label: "거부 처리",
      target_status: "거부",
      enabled: true,
      destructive: true,
      requires_memo: true,
    },
  ],
  tracking_actions: [
    {
      kind: "return",
      label: "반송 송장 수정",
      enabled: true,
    },
  ],
};

const repairClaim: AdminClaimDetailOut = {
  ...claim,
  shipping: {
    ...claim.shipping,
    repair_receipts: [
      {
        id: "receipt-1",
        receipt_type: "tracking",
        reason: "lost",
        memo: "포장 상태 확인",
        photo_count: 1,
        created_at: "2026-07-12T02:00:00Z",
      },
    ],
  },
};

const repairPhoto: AdminRepairPhotoOut = {
  id: "photo-1",
  content_type: "image/jpeg",
  size_bytes: 2_048,
  created_at: "2026-07-12T02:01:00Z",
};

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="현재 검색 조건">{location.search}</output>;
}

function renderPage(entry = "/claims/claim-1") {
  return renderAdminPage(
    <Routes>
      <Route
        path="/claims/:claimId"
        element={
          <>
            <ClaimDetailPage />
            <LocationProbe />
          </>
        }
      />
    </Routes>,
    { entry },
  );
}

describe("ClaimDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blocker.state = "unblocked";
    api.getClaim.mockResolvedValue(claim);
    api.listPhotos.mockResolvedValue([]);
  });

  it("URL의 업무 탭을 복원하고 운영 액션을 모든 탭 상단에 유지한다", async () => {
    const user = userEvent.setup();
    renderPage("/claims/claim-1?tab=shipping");

    expect(
      await screen.findByRole("tab", { name: "배송·첨부", selected: true }),
    ).toBeTruthy();
    expect(
      await screen.findByText("등록된 배송 정보가 없습니다."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "거부 처리" })).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "개요" }));

    expect(
      await screen.findByRole("button", { name: "거부 처리" }),
    ).toBeTruthy();
    expect(screen.getByText("상품 불량")).toBeTruthy();
    expect(screen.queryByText("defect")).toBeNull();
    expect(screen.getByLabelText("현재 검색 조건").textContent).toBe("");
  });

  it("토큰 환불은 배송 탭과 긴 빈 배송 필드를 노출하지 않는다", async () => {
    api.getClaim.mockResolvedValueOnce({
      ...claim,
      type: "token_refund",
      tracking_actions: [],
    });
    renderPage("/claims/claim-1?tab=shipping");

    expect(
      await screen.findByRole("tab", { name: "개요", selected: true }),
    ).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "배송·첨부" })).toBeNull();
    expect(screen.queryByText("배송 주소")).toBeNull();
    expect(screen.getByRole("button", { name: "거부 처리" })).toBeTruthy();
  });

  it("위험 상태 변경을 확인하고 실패해도 입력한 사유를 보존한다", async () => {
    const user = userEvent.setup();
    api.updateStatus.mockRejectedValueOnce(new Error("상태 충돌"));
    api.getClaim.mockResolvedValueOnce({
      ...claim,
      admin_actions: [
        ...(claim.admin_actions ?? []),
        {
          kind: "advance",
          label: "승인 처리",
          target_status: "승인",
          enabled: true,
        },
      ],
    });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "거부 처리" }));
    const memo = screen.getByLabelText("처리 사유 (필수)");
    await user.type(memo, "검수 결과 불량");
    expect(
      (screen.getByRole("button", { name: "승인 처리" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect((memo as HTMLTextAreaElement).value).toBe("검수 결과 불량");
    await user.click(screen.getByRole("button", { name: "거부 처리 검토" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/상태 접수 → 거부/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "거부 처리" }));

    await waitFor(() =>
      expect(api.updateStatus).toHaveBeenCalledWith(
        {
          path: { claim_id: "claim-1" },
          body: {
            new_status: "거부",
            memo: "검수 결과 불량",
            is_rollback: false,
          },
        },
        expect.anything(),
      ),
    );
    expect(await screen.findByText("상태 충돌")).toBeTruthy();
    expect((memo as HTMLTextAreaElement).value).toBe("검수 결과 불량");
  });

  it("다른 송장 작업으로 전환하기 전에 입력 폐기를 확인한다", async () => {
    const user = userEvent.setup();
    api.getClaim.mockResolvedValueOnce({
      ...claim,
      tracking_actions: [
        ...(claim.tracking_actions ?? []),
        { kind: "resend", label: "재발송 송장 수정", enabled: true },
      ],
    });
    renderPage("/claims/claim-1?tab=shipping");

    await user.click(
      await screen.findByRole("button", { name: "반송 송장 수정" }),
    );
    await user.type(screen.getByLabelText("택배사"), "우체국");
    await user.type(screen.getByLabelText("송장번호"), "1234-5678");
    await user.click(screen.getByRole("button", { name: "재발송 송장 수정" }));

    let dialog = await screen.findByRole("alertdialog", {
      name: "작성 중인 송장 정보를 버릴까요?",
    });
    expect((screen.getByLabelText("택배사") as HTMLInputElement).value).toBe(
      "우체국",
    );
    await user.click(within(dialog).getByRole("button", { name: "계속 작성" }));
    expect((screen.getByLabelText("택배사") as HTMLInputElement).value).toBe(
      "우체국",
    );

    await user.click(screen.getByRole("button", { name: "재발송 송장 수정" }));
    dialog = await screen.findByRole("alertdialog", {
      name: "작성 중인 송장 정보를 버릴까요?",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "버리고 작업 전환" }),
    );
    expect((screen.getByLabelText("택배사") as HTMLInputElement).value).toBe(
      "",
    );
  });

  it("실패한 알림을 생성 클라이언트 뮤테이션으로 다시 요청한다", async () => {
    const user = userEvent.setup();
    api.retryNotification.mockResolvedValueOnce({
      ...claim.notifications?.[0],
      delivery_status: "sent",
    } as ClaimNotificationOut);
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "알림·결제" }));
    await user.click(await screen.findByRole("button", { name: "다시 발송" }));

    await waitFor(() =>
      expect(api.retryNotification).toHaveBeenCalledWith(
        {
          path: { notification_id: "notification-1" },
        },
        expect.anything(),
      ),
    );
  });

  it("이동 확인 후 기본·송장 작업 상태를 모두 지우고 blocker를 진행한다", async () => {
    const user = userEvent.setup();
    blocker.proceed.mockImplementation(() => {
      blocker.state = "unblocked";
    });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "거부 처리" }));
    await user.type(screen.getByLabelText("처리 사유 (필수)"), "검수 불량");
    await user.click(screen.getByRole("tab", { name: "배송·첨부" }));
    await user.click(
      await screen.findByRole("button", { name: "반송 송장 수정" }),
    );
    const courier = screen.getByLabelText("택배사");
    await user.type(courier, "우체국");
    blocker.state = "blocked";
    await user.type(courier, "택배");

    const dialog = await screen.findByRole("alertdialog", {
      name: "작성 중인 클레임 작업을 버릴까요?",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "클레임 작업 버리기" }),
    );

    expect(blocker.proceed).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("처리 사유 (필수)")).toBeNull();
    expect(screen.queryByLabelText("택배사")).toBeNull();
  });

  it("송장 저장 실패 시 멱등 키와 운영자 입력을 보존한다", async () => {
    const user = userEvent.setup();
    api.updateTracking.mockRejectedValueOnce(new Error("송장 충돌"));
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "배송·첨부" }));
    await user.click(
      await screen.findByRole("button", { name: "반송 송장 수정" }),
    );
    await user.type(screen.getByLabelText("택배사"), "우체국");
    await user.type(screen.getByLabelText("송장번호"), "1234-5678");
    await user.type(screen.getByLabelText("변경 사유"), "고객 반송 확인");
    await user.click(screen.getByRole("button", { name: "송장 저장" }));

    await waitFor(() =>
      expect(api.updateTracking).toHaveBeenCalledWith(
        {
          path: { claim_id: "claim-1" },
          body: {
            operation_id: expect.any(String),
            kind: "return",
            courier_company: "우체국",
            tracking_number: "1234-5678",
            memo: "고객 반송 확인",
          },
        },
        expect.anything(),
      ),
    );
    const operationId = api.updateTracking.mock.calls[0]?.[0].body.operation_id;
    expect(await screen.findByText("송장 충돌")).toBeTruthy();
    expect((screen.getByLabelText("택배사") as HTMLInputElement).value).toBe(
      "우체국",
    );

    await user.click(screen.getByRole("button", { name: "송장 저장" }));
    await waitFor(() => expect(api.updateTracking).toHaveBeenCalledTimes(2));
    expect(api.updateTracking.mock.calls[1]?.[0].body.operation_id).toBe(
      operationId,
    );
  });

  it("송장 저장 실패 뒤 입력을 바꾸면 새 멱등 키를 사용한다", async () => {
    const user = userEvent.setup();
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValue("00000000-0000-4000-8000-000000000002");
    api.updateTracking.mockRejectedValue(new Error("송장 충돌"));
    renderPage("/claims/claim-1?tab=shipping");

    await user.click(
      await screen.findByRole("button", { name: "반송 송장 수정" }),
    );
    await user.type(screen.getByLabelText("택배사"), "우체국");
    await user.type(screen.getByLabelText("송장번호"), "1234-5678");
    await user.type(screen.getByLabelText("변경 사유"), "고객 반송 확인");
    await user.click(screen.getByRole("button", { name: "송장 저장" }));
    expect(await screen.findByText("송장 충돌")).toBeTruthy();

    await user.type(screen.getByLabelText("변경 사유"), " 완료");
    await user.click(screen.getByRole("button", { name: "송장 저장" }));

    await waitFor(() => expect(api.updateTracking).toHaveBeenCalledTimes(2));
    expect(api.updateTracking.mock.calls[0]?.[0].body.operation_id).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(api.updateTracking.mock.calls[1]?.[0].body.operation_id).toBe(
      "00000000-0000-4000-8000-000000000002",
    );
  });

  it("활동 이력은 업무 설명을 우선하고 내부 식별자는 접힌 기술 정보에 둔다", async () => {
    const user = userEvent.setup();
    api.getClaim.mockResolvedValueOnce({
      ...claim,
      timeline: [
        {
          event_type: "claim_status",
          title: "검수 완료",
          description: "반품 검수를 완료했습니다.",
          actor_id: "operator-1",
          created_at: "2026-07-12T03:00:00Z",
        },
      ],
    });
    renderPage("/claims/claim-1?tab=activity");

    expect(await screen.findByText("검수 완료")).toBeTruthy();
    expect(screen.getByText("반품 검수를 완료했습니다.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "기술 정보" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "기술 정보" }));

    expect(
      within(screen.getByRole("region", { name: "기술 정보" })).getByText(
        /"actor_id": "operator-1"/,
      ),
    ).toBeTruthy();
  });

  it("접수·사진 ID 관계로 목록과 만료 URL을 발급하고 재발급한다", async () => {
    const user = userEvent.setup();
    api.getClaim.mockResolvedValueOnce(repairClaim);
    api.listPhotos.mockResolvedValueOnce([repairPhoto]);
    api.createPhotoReadUrl
      .mockResolvedValueOnce({ read_url: "https://storage.example/signed-1" })
      .mockResolvedValueOnce({ read_url: "https://storage.example/signed-2" });
    const { container } = renderPage("/claims/claim-1?tab=shipping");

    expect(await screen.findByText("송장 분실 · 사진 1장")).toBeTruthy();
    expect(screen.getByText("송장 등록")).toBeTruthy();
    expect(api.photoListOptions).toHaveBeenCalledWith({
      path: { receipt_id: "receipt-1" },
    });
    expect(
      screen.queryByRole("img", { name: "수선 배송 접수 사진 1" }),
    ).toBeNull();

    await user.click(
      await screen.findByRole("button", { name: "이미지 보기" }),
    );

    const image = await screen.findByRole("img", {
      name: "수선 배송 접수 사진 1",
    });
    expect(image.getAttribute("src")).toBe("https://storage.example/signed-1");
    expect(api.createPhotoReadUrl).toHaveBeenCalledWith(
      {
        path: { receipt_id: "receipt-1", image_id: "photo-1" },
      },
      expect.anything(),
    );
    expect(container.textContent).not.toContain("object_key");
    expect(container.textContent).not.toContain(
      "uploads/repair_shipping_upload",
    );

    await user.click(screen.getByRole("button", { name: "URL 재발급" }));
    await waitFor(() =>
      expect(api.createPhotoReadUrl).toHaveBeenCalledTimes(2),
    );
    expect(image.getAttribute("src")).toBe("https://storage.example/signed-2");
  });

  it("관계형 사진 목록이 비어 있으면 명시적인 빈 상태를 표시한다", async () => {
    api.getClaim.mockResolvedValueOnce(repairClaim);
    renderPage("/claims/claim-1?tab=shipping");

    expect(await screen.findByText("등록된 사진이 없습니다")).toBeTruthy();
  });

  it("사진 목록 오류를 접수 단위로 다시 시도한다", async () => {
    const user = userEvent.setup();
    api.getClaim.mockResolvedValueOnce(repairClaim);
    api.listPhotos.mockRejectedValueOnce(new Error("사진 목록 오류"));
    renderPage("/claims/claim-1?tab=shipping");

    expect(
      await screen.findByText("사진 목록을 불러오지 못했습니다"),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(await screen.findByText("등록된 사진이 없습니다")).toBeTruthy();
    expect(api.listPhotos).toHaveBeenCalledTimes(2);
  });
});

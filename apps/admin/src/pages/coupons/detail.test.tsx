import type {
  AdminCouponOut,
  IssuedCouponOut,
  PageCouponAudienceCustomerOut,
  PageIssuedCouponOut,
} from "@essesion/api-client";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({
  getCoupon: vi.fn(),
  updateCoupon: vi.fn(),
  preview: vi.fn(),
  issue: vi.fn(),
  listIssued: vi.fn(),
  revoke: vi.fn(),
}));
const auth = vi.hoisted(() => ({ role: "admin" as "admin" | "manager" }));

vi.mock("@essesion/api-client/query", () => ({
  getAdminCouponOptions: () => ({
    queryKey: ["coupon"],
    queryFn: api.getCoupon,
  }),
  getAdminCouponQueryKey: () => ["coupon"],
  listAdminCouponsQueryKey: () => ["coupons"],
  updateAdminCouponMutation: () => ({ mutationFn: api.updateCoupon }),
  previewCouponAudienceMutation: () => ({ mutationFn: api.preview }),
  issueCouponMutation: () => ({ mutationFn: api.issue }),
  listIssuedCouponsOptions: () => ({
    queryKey: ["issued"],
    queryFn: api.listIssued,
  }),
  revokeCouponsMutation: () => ({ mutationFn: api.revoke }),
}));

vi.mock("../../shared/session/admin-session", () => ({
  useAdminSession: () => ({
    state: {
      status: "authenticated",
      session: { userId: "admin-1", displayName: "운영자", role: auth.role },
    },
  }),
}));

vi.mock("../../shared/lib/use-dirty-form-blocker", () => ({
  useDirtyFormBlocker: () => ({ state: "unblocked" }),
}));

import { CouponDetailPage } from "./detail";
import { CouponEditPage } from "./edit";

const coupon: AdminCouponOut = {
  id: "coupon-1",
  name: "여름 할인",
  display_name: "여름맞이 할인",
  discount_type: "percentage",
  discount_value: "10",
  max_discount_amount: "5000",
  description: "여름 할인 쿠폰",
  expiry_date: "2027-08-31",
  additional_info: null,
  is_active: true,
  issued_count: 1,
  active_issued_count: 1,
  created_at: "2026-07-12T01:00:00Z",
  updated_at: "2026-07-12T01:00:00Z",
};

const preview: PageCouponAudienceCustomerOut = {
  items: [
    {
      id: "customer-1",
      name: "홍길동",
      email: "customer@example.com",
      phone: "010-0000-0000",
      created_at: "2026-07-01T01:00:00Z",
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
};

const issuance: IssuedCouponOut = {
  id: "issuance-1",
  user_id: "customer-1",
  user_name: "홍길동",
  user_email: "customer@example.com",
  user_phone: "010-0000-0000",
  status: "active",
  issued_at: "2026-07-12T01:00:00Z",
  expires_at: "2027-09-01T00:00:00+09:00",
  used_at: null,
  terms_snapshot: {
    discount_type: "percentage",
    discount_value: "10",
    max_discount_amount: "5000",
    expiry_date: "2027-08-31",
  },
};

const issuedPage: PageIssuedCouponOut = {
  items: [issuance],
  total: 1,
  limit: 20,
  offset: 0,
};

function renderPage(entry = "/coupons/coupon-1") {
  renderAdminPage(
    <Routes>
      <Route path="/coupons/:couponId" element={<CouponDetailPage />} />
      <Route path="/coupons/:couponId/edit" element={<CouponEditPage />} />
    </Routes>,
    { entry },
  );
}

describe("CouponDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.role = "admin";
    api.getCoupon.mockResolvedValue(coupon);
    api.preview.mockResolvedValue(preview);
    api.listIssued.mockResolvedValue(issuedPage);
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValue("00000000-0000-4000-8000-000000000002");
  });

  it("stale 저장 실패 시 입력과 기준 revision을 보존한다", async () => {
    const user = userEvent.setup();
    api.updateCoupon.mockRejectedValueOnce(
      new Error("다른 관리자가 수정했습니다"),
    );
    renderPage("/coupons/coupon-1/edit");

    const discount = await screen.findByLabelText(/할인율/);
    await user.clear(discount);
    await user.type(discount, "15");
    await user.click(screen.getByRole("button", { name: "쿠폰 변경 저장" }));

    await waitFor(() =>
      expect(api.updateCoupon).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { coupon_id: "coupon-1" },
          body: expect.objectContaining({
            discount_value: 15,
            expected_updated_at: coupon.updated_at,
          }),
        }),
        expect.anything(),
      ),
    );
    expect(await screen.findByText("다른 관리자가 수정했습니다")).toBeTruthy();
    expect((discount as HTMLInputElement).value).toBe("15");
  });

  it("대상 미리보기 로딩 중에는 임시 0건 요약을 숨기고 성공 후 범위를 표시한다", async () => {
    const user = userEvent.setup();
    let resolvePreview:
      | ((value: PageCouponAudienceCustomerOut) => void)
      | undefined;
    api.preview.mockReturnValue(
      new Promise<PageCouponAudienceCustomerOut>((resolve) => {
        resolvePreview = resolve;
      }),
    );
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "발급 운영" }));
    await user.click(screen.getByRole("button", { name: "대상 미리보기" }));

    expect(screen.queryByText(/예상 대상 0명/)).toBeNull();
    expect(
      screen.queryByRole("navigation", {
        name: "쿠폰 대상 미리보기 페이지",
      }),
    ).toBeNull();
    expect(screen.queryByText(/총 0건/)).toBeNull();

    await act(async () => resolvePreview?.(preview));
    expect(await screen.findByText("1–1 / 총 1건")).toBeTruthy();
    expect(screen.getByText("페이지당 20개")).toBeTruthy();
  });

  it("미리보기 고객군 발급의 동일 재시도는 작업 ID를 유지하고 입력 변경 시 교체한다", async () => {
    const user = userEvent.setup();
    api.issue.mockRejectedValue(new Error("일시적인 발급 실패"));
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "발급 운영" }));
    await user.click(screen.getByRole("button", { name: "대상 미리보기" }));
    expect(await screen.findByText("customer@example.com")).toBeTruthy();
    await user.type(screen.getByLabelText(/발급 사유/), "여름 행사 대상 발급");
    await user.click(
      screen.getByRole("button", { name: "쿠폰 1명 발급 검토" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/이미 발급된 고객 제외/)).toBeTruthy();
    expect(within(dialog).getByText(/2027.*8.*31/)).toBeTruthy();
    await user.click(
      within(dialog).getByRole("button", { name: "1명에게 쿠폰 발급" }),
    );

    await waitFor(() =>
      expect(api.issue).toHaveBeenCalledWith(
        {
          path: { coupon_id: "coupon-1" },
          body: {
            operation_id: "00000000-0000-4000-8000-000000000001",
            reason: "여름 행사 대상 발급",
            exclude_issued: true,
            segment: "all",
            expected_count: 1,
          },
        },
        expect.anything(),
      ),
    );
    expect(await screen.findByText("일시적인 발급 실패")).toBeTruthy();
    expect(
      (screen.getByLabelText(/발급 사유/) as HTMLTextAreaElement).value,
    ).toBe("여름 행사 대상 발급");
    expect(
      screen.queryByText(/00000000-0000-4000-8000-000000000001/),
    ).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "쿠폰 1명 발급 검토" }),
    );
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "1명에게 쿠폰 발급",
      }),
    );
    await waitFor(() => expect(api.issue).toHaveBeenCalledTimes(2));
    expect(api.issue.mock.calls[1]?.[0].body.operation_id).toBe(
      api.issue.mock.calls[0]?.[0].body.operation_id,
    );

    await user.type(screen.getByLabelText(/발급 사유/), " 추가");
    expect(screen.queryByText("일시적인 발급 실패")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "쿠폰 1명 발급 검토" }),
    );
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "1명에게 쿠폰 발급",
      }),
    );
    await waitFor(() => expect(api.issue).toHaveBeenCalledTimes(3));
    expect(api.issue.mock.calls[2]?.[0].body.operation_id).toBe(
      "00000000-0000-4000-8000-000000000002",
    );
  });

  it("활성 발급 건의 대상·영향·사유를 확인하고 회수한다", async () => {
    const user = userEvent.setup();
    api.revoke.mockRejectedValue(new Error("일시적인 회수 실패"));
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "발급 이력" }));
    await user.click(
      await screen.findByRole("checkbox", { name: "홍길동 발급 건 선택" }),
    );
    await user.type(screen.getByLabelText(/회수 사유/), "오발급 회수 처리");
    await user.click(
      screen.getByRole("button", { name: "쿠폰 1건 회수 검토" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(/이 화면에서 되돌릴 수 없습니다/),
    ).toBeTruthy();
    await user.click(
      within(dialog).getByRole("button", { name: "쿠폰 1건 회수" }),
    );

    await waitFor(() =>
      expect(api.revoke).toHaveBeenCalledWith(
        {
          body: {
            operation_id: "00000000-0000-4000-8000-000000000001",
            reason: "오발급 회수 처리",
            user_coupon_ids: ["issuance-1"],
          },
        },
        expect.anything(),
      ),
    );
    expect(await screen.findByText("일시적인 회수 실패")).toBeTruthy();
    expect(
      (screen.getByLabelText(/회수 사유/) as HTMLTextAreaElement).value,
    ).toBe("오발급 회수 처리");

    await user.click(
      screen.getByRole("button", { name: "쿠폰 1건 회수 검토" }),
    );
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "쿠폰 1건 회수",
      }),
    );
    await waitFor(() => expect(api.revoke).toHaveBeenCalledTimes(2));
    expect(api.revoke.mock.calls[1]?.[0].body.operation_id).toBe(
      api.revoke.mock.calls[0]?.[0].body.operation_id,
    );

    await user.type(screen.getByLabelText(/회수 사유/), " 추가");
    expect(screen.queryByText("일시적인 회수 실패")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "쿠폰 1건 회수 검토" }),
    );
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "쿠폰 1건 회수",
      }),
    );
    await waitFor(() => expect(api.revoke).toHaveBeenCalledTimes(3));
    expect(api.revoke.mock.calls[2]?.[0].body.operation_id).toBe(
      "00000000-0000-4000-8000-000000000002",
    );
  });

  it("manager에게는 고객군 미리보기만 제공하고 일괄 변경 입력을 숨긴다", async () => {
    const user = userEvent.setup();
    auth.role = "manager";
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "발급 운영" }));

    expect(screen.getByRole("button", { name: "대상 미리보기" })).toBeTruthy();
    expect(screen.getByText(/조회 전용 권한/)).toBeTruthy();
    expect(screen.queryByLabelText("발급 사유")).toBeNull();
  });
});

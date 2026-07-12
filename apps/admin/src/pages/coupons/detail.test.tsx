import type {
  AdminCouponOut,
  IssuedCouponOut,
  PageCouponAudienceCustomerOut,
  PageIssuedCouponOut,
} from "@essesion/api-client";
import { screen, waitFor, within } from "@testing-library/react";
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

function renderPage() {
  renderAdminPage(
    <Routes>
      <Route path="/coupons/:couponId" element={<CouponDetailPage />} />
    </Routes>,
    { entry: "/coupons/coupon-1" },
  );
}

describe("CouponDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.role = "admin";
    api.getCoupon.mockResolvedValue(coupon);
    api.preview.mockResolvedValue(preview);
    api.listIssued.mockResolvedValue(issuedPage);
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001",
    );
  });

  it("stale 저장 실패 시 입력과 기준 revision을 보존한다", async () => {
    const user = userEvent.setup();
    api.updateCoupon.mockRejectedValueOnce(
      new Error("다른 관리자가 수정했습니다"),
    );
    renderPage();

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

  it("미리보기 고객군을 같은 operation UUID와 사유로 발급한다", async () => {
    const user = userEvent.setup();
    api.issue.mockRejectedValueOnce(new Error("일시적인 발급 실패"));
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "발급 운영" }));
    await user.click(screen.getByRole("button", { name: "대상 미리보기" }));
    expect(await screen.findByText("customer@example.com")).toBeTruthy();
    await user.type(screen.getByLabelText(/발급 사유/), "여름 행사 대상 발급");
    await user.click(screen.getByRole("button", { name: "발급 내용 확인" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "발급" }));

    await waitFor(() =>
      expect(api.issue).toHaveBeenCalledWith(
        {
          path: { coupon_id: "coupon-1" },
          body: {
            operation_id: "00000000-0000-4000-8000-000000000001",
            reason: "여름 행사 대상 발급",
            exclude_issued: true,
            segment: "all",
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
      screen.getByText(/operation 00000000-0000-4000-8000-000000000001/),
    ).toBeTruthy();
  });

  it("활성 발급 건을 operation UUID·사유·확인과 함께 회수한다", async () => {
    const user = userEvent.setup();
    api.revoke.mockRejectedValueOnce(new Error("일시적인 회수 실패"));
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "발급 이력" }));
    await user.click(
      await screen.findByRole("checkbox", { name: "홍길동 발급 건 선택" }),
    );
    await user.type(screen.getByLabelText(/회수 사유/), "오발급 회수 처리");
    await user.click(screen.getByRole("button", { name: "회수 내용 확인" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "회수" }));

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
  });

  it("manager에게는 고객군 미리보기만 제공하고 일괄 변경 입력을 숨긴다", async () => {
    const user = userEvent.setup();
    auth.role = "manager";
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "발급 운영" }));

    expect(screen.getByRole("button", { name: "대상 미리보기" })).toBeTruthy();
    expect(screen.getByText("조회 전용 권한")).toBeTruthy();
    expect(screen.queryByLabelText("발급 사유")).toBeNull();
  });
});

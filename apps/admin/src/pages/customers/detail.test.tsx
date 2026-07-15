import type {
  AdminCustomerDetailOut,
  PageAdminCustomerCouponOut,
  PageAdminCustomerOrderOut,
  PageAdminCustomerTokenOut,
} from "@essesion/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({
  detail: vi.fn(),
  orders: vi.fn(),
  coupons: vi.fn(),
  tokens: vi.fn(),
  adjust: vi.fn(),
}));

vi.mock("@essesion/api-client/query", () => ({
  getAdminCustomerOptions: () => ({
    queryKey: ["customer"],
    queryFn: api.detail,
  }),
  getAdminCustomerQueryKey: () => ["customer"],
  listAdminCustomerOrdersOptions: () => ({
    queryKey: ["customer-orders"],
    queryFn: api.orders,
  }),
  listAdminCustomerOrdersQueryKey: () => ["customer-orders"],
  listAdminCustomerCouponsOptions: () => ({
    queryKey: ["customer-coupons"],
    queryFn: api.coupons,
  }),
  listAdminCustomerCouponsQueryKey: () => ["customer-coupons"],
  listAdminCustomerTokensOptions: () => ({
    queryKey: ["customer-tokens"],
    queryFn: api.tokens,
  }),
  listAdminCustomerTokensQueryKey: () => ["customer-tokens"],
  adminManageTokensMutation: () => ({ mutationFn: api.adjust }),
}));

vi.mock("../../shared/session/admin-session", () => ({
  useAdminSession: () => ({
    state: {
      status: "authenticated",
      session: { userId: "admin-1", displayName: "운영자", role: "admin" },
    },
  }),
}));

import { CustomerDetailPage } from "./detail";

const customer: AdminCustomerDetailOut = {
  id: "customer-1",
  email: "customer@example.com",
  name: "홍길동",
  phone: "01012345678",
  is_active: true,
  phone_verified: true,
  created_at: "2026-07-12T01:00:00Z",
  updated_at: "2026-07-12T01:00:00Z",
  birth: null,
  notification_consent: true,
  notification_enabled: true,
  marketing_kakao_sms_consent: false,
  token_balance: 12,
  paid_token_balance: 10,
  bonus_token_balance: 2,
  order_count: 0,
  active_coupon_count: 0,
};

const orders: PageAdminCustomerOrderOut = {
  items: [],
  total: 0,
  limit: 5,
  offset: 0,
};
const coupons: PageAdminCustomerCouponOut = {
  items: [],
  total: 0,
  limit: 5,
  offset: 0,
};
const tokens: PageAdminCustomerTokenOut = {
  items: [],
  total: 0,
  limit: 5,
  offset: 0,
};

function renderPage() {
  return renderAdminPage(
    <Routes>
      <Route path="/customers/:userId" element={<CustomerDetailPage />} />
    </Routes>,
    { entry: "/customers/customer-1" },
  );
}

describe("CustomerDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.detail.mockResolvedValue(customer);
    api.orders.mockResolvedValue(orders);
    api.coupons.mockResolvedValue(coupons);
    api.tokens.mockResolvedValue(tokens);
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001",
    );
  });

  it("토큰 회수를 확인하고 실패해도 입력과 operation id를 보존한다", async () => {
    const user = userEvent.setup();
    api.adjust.mockRejectedValue(new Error("회수 가능한 잔액이 부족합니다"));
    renderPage();

    await screen.findByRole("heading", { name: "홍길동", level: 1 });
    const amount = screen.getByLabelText("조정 수량") as HTMLInputElement;
    const reason = screen.getByLabelText(/처리 사유/) as HTMLTextAreaElement;
    await user.type(amount, "-5");
    await user.type(reason, "오지급 토큰 회수");
    await user.click(screen.getByRole("button", { name: "조정 내용 확인" }));

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "회수" }));

    await waitFor(() =>
      expect(api.adjust).toHaveBeenCalledWith(
        {
          body: {
            operation_id: "00000000-0000-4000-8000-000000000001",
            user_id: "customer-1",
            amount: -5,
            description: "오지급 토큰 회수",
          },
        },
        expect.anything(),
      ),
    );
    expect(
      await screen.findByText("회수 가능한 잔액이 부족합니다"),
    ).toBeTruthy();
    expect(amount.value).toBe("-5");
    expect(reason.value).toBe("오지급 토큰 회수");
    expect(
      screen.getByText(/operation 00000000-0000-4000-8000-000000000001/),
    ).toBeTruthy();
  });
});

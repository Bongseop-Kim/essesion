import type {
  AdminCustomerDetailOut,
  AdminCustomerOrderOut,
  PageAdminCustomerCouponOut,
  PageAdminCustomerOrderOut,
  PageAdminCustomerTokenOut,
} from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
  useNavigate,
} from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  listAdminCustomerOrdersOptions: (options: { query: { offset: number } }) => ({
    queryKey: ["customer-orders", options.query.offset],
    queryFn: () => api.orders(options),
  }),
  listAdminCustomerOrdersQueryKey: () => ["customer-orders"],
  listAdminCustomerCouponsOptions: (options: {
    query: { offset: number };
  }) => ({
    queryKey: ["customer-coupons", options.query.offset],
    queryFn: () => api.coupons(options),
  }),
  listAdminCustomerCouponsQueryKey: () => ["customer-coupons"],
  listAdminCustomerTokensOptions: (options: { query: { offset: number } }) => ({
    queryKey: ["customer-tokens", options.query.offset],
    queryFn: () => api.tokens(options),
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

const lastOrder: AdminCustomerOrderOut = {
  id: "order-6",
  order_number: "ORD-0006",
  order_type: "product",
  total_price: 12000,
  status: "paid",
  created_at: "2026-07-12T01:00:00Z",
};

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <output data-testid="location-path">{location.pathname}</output>
      <output data-testid="location-search">{location.search}</output>
    </>
  );
}

function NavigationProbe() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate("?tab=orders")}>
        주문 탭으로 이동
      </button>
      <button type="button" onClick={() => navigate("/orders")}>
        주문 목록으로 이동
      </button>
    </>
  );
}

function renderPage(entry = "/customers/customer-1") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/customers/:userId",
        element: (
          <>
            <CustomerDetailPage />
            <LocationProbe />
            <NavigationProbe />
          </>
        ),
      },
      { path: "/orders", element: <h1>주문 목록</h1> },
    ],
    { initialEntries: [entry] },
  );
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
    queryClient,
    router,
  };
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

  it("기본 화면은 토큰 입력과 operation id를 숨기고 탭을 URL에 보존한다", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "홍길동", level: 1 });
    expect(screen.queryByLabelText("조정 수량")).toBeNull();
    expect(
      screen.queryByText(/00000000-0000-4000-8000-000000000001/),
    ).toBeNull();

    await user.click(screen.getByRole("tab", { name: "주문" }));
    expect(screen.getByTestId("location-search").textContent).toBe(
      "?tab=orders",
    );
    expect(
      screen.getByRole("tab", { name: "주문" }).getAttribute("aria-selected"),
    ).toBe("true");

    await user.click(screen.getByRole("tab", { name: "개요" }));
    expect(screen.getByTestId("location-search").textContent).toBe("");
  });

  it("이력 페이지가 범위를 넘으면 URL을 마지막 페이지로 보정하고 해당 행을 다시 조회한다", async () => {
    api.orders.mockImplementation(({ query }: { query: { offset: number } }) =>
      Promise.resolve({
        items: query.offset === 5 ? [lastOrder] : [],
        total: 6,
        limit: 5,
        offset: query.offset,
      } satisfies PageAdminCustomerOrderOut),
    );
    api.coupons.mockImplementation(({ query }: { query: { offset: number } }) =>
      Promise.resolve({ ...coupons, total: 11, offset: query.offset }),
    );
    api.tokens.mockImplementation(({ query }: { query: { offset: number } }) =>
      Promise.resolve({ ...tokens, total: 1, offset: query.offset }),
    );

    renderPage(
      "/customers/customer-1?tab=orders&ordersPage=9&couponsPage=8&tokensPage=7&source=keep",
    );

    expect(await screen.findByText("ORD-0006")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("location-search").textContent).toBe(
        "?tab=orders&ordersPage=2&couponsPage=3&source=keep",
      ),
    );
    expect(screen.getByText("6–6 / 총 6건")).toBeTruthy();
    expect(api.orders).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ offset: 5 }),
      }),
    );
  });

  it("토큰 회수 실패 뒤 입력과 operation id를 보존해 같은 요청을 재시도한다", async () => {
    const user = userEvent.setup();
    api.adjust.mockRejectedValue(new Error("회수 가능한 잔액이 부족합니다"));
    renderPage();

    await screen.findByRole("heading", { name: "홍길동", level: 1 });
    await user.click(screen.getByRole("button", { name: "토큰 조정" }));
    const dialog = await screen.findByRole("dialog", {
      name: "홍길동 고객 토큰 조정",
    });
    const amount = within(dialog).getByLabelText(
      "조정 수량",
    ) as HTMLInputElement;
    const reason = within(dialog).getByLabelText(
      /처리 사유/,
    ) as HTMLTextAreaElement;
    await user.type(amount, "-5");
    await user.type(reason, "오지급 토큰 회수");
    expect(within(dialog).getByText("현재 12개 → 변경 후 7개")).toBeTruthy();
    await user.click(
      within(dialog).getByRole("button", { name: "조정 내용 검토" }),
    );

    expect(within(dialog).getByText("유료 토큰 10개 → 5개")).toBeTruthy();
    expect(within(dialog).getByText("보너스 토큰 2개 → 2개")).toBeTruthy();
    await user.click(
      within(dialog).getByRole("button", { name: "토큰 5개 회수" }),
    );

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
    await user.click(within(dialog).getByRole("button", { name: "입력 수정" }));
    expect(amount.value).toBe("-5");
    expect(reason.value).toBe("오지급 토큰 회수");
    expect(
      screen.queryByText(/00000000-0000-4000-8000-000000000001/),
    ).toBeNull();

    await user.click(
      within(dialog).getByRole("button", { name: "조정 내용 검토" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "토큰 5개 회수" }),
    );
    await waitFor(() => expect(api.adjust).toHaveBeenCalledTimes(2));
    expect(api.adjust.mock.calls[1]?.[0].body.operation_id).toBe(
      api.adjust.mock.calls[0]?.[0].body.operation_id,
    );
  });

  it("토큰 지급 성공 시 입력을 비우고 조정 창을 닫는다", async () => {
    const user = userEvent.setup();
    api.adjust.mockResolvedValue({
      success: true,
      new_balance: 17,
      operation_id: "00000000-0000-4000-8000-000000000001",
    });
    renderPage();

    await screen.findByRole("heading", { name: "홍길동", level: 1 });
    await user.click(screen.getByRole("button", { name: "토큰 조정" }));
    const dialog = await screen.findByRole("dialog", {
      name: "홍길동 고객 토큰 조정",
    });
    await user.type(within(dialog).getByLabelText("조정 수량"), "5");
    await user.type(
      within(dialog).getByLabelText(/처리 사유/),
      "프로모션 토큰 지급",
    );
    expect(within(dialog).getByText("현재 12개 → 변경 후 17개")).toBeTruthy();
    await user.click(
      within(dialog).getByRole("button", { name: "조정 내용 검토" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "토큰 5개 지급" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "홍길동 고객 토큰 조정" }),
      ).toBeNull(),
    );
    await user.click(screen.getByRole("button", { name: "토큰 조정" }));
    const reopened = await screen.findByRole("dialog", {
      name: "홍길동 고객 토큰 조정",
    });
    expect(
      (within(reopened).getByLabelText("조정 수량") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (within(reopened).getByLabelText(/처리 사유/) as HTMLTextAreaElement)
        .value,
    ).toBe("");
  });

  it("작성 중인 토큰 조정을 닫을 때 같은 창에서 이탈을 확인한다", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "홍길동", level: 1 });
    await user.click(screen.getByRole("button", { name: "토큰 조정" }));
    const dialog = await screen.findByRole("dialog", {
      name: "홍길동 고객 토큰 조정",
    });
    await user.type(within(dialog).getByLabelText("조정 수량"), "5");
    await user.type(within(dialog).getByLabelText(/처리 사유/), "테스트 지급");
    await user.click(within(dialog).getByRole("button", { name: "취소" }));

    expect(
      within(dialog).getByText("저장하지 않은 토큰 조정을 버릴까요?"),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "계속 편집" }));
    expect(
      (within(dialog).getByLabelText("조정 수량") as HTMLInputElement).value,
    ).toBe("5");

    await user.click(within(dialog).getByRole("button", { name: "취소" }));
    await user.click(
      within(dialog).getByRole("button", { name: "변경 버리기" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "홍길동 고객 토큰 조정" }),
    ).toBeNull();
  });

  it("작성 중 경로·쿼리 이동을 같은 창에서 막고 선택에 따라 취소하거나 진행한다", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "홍길동", level: 1 });
    await user.click(screen.getByRole("button", { name: "토큰 조정" }));
    const dialog = await screen.findByRole("dialog", {
      name: "홍길동 고객 토큰 조정",
    });
    await user.type(within(dialog).getByLabelText("조정 수량"), "5");
    await user.type(within(dialog).getByLabelText(/처리 사유/), "테스트 지급");

    await user.click(screen.getByRole("button", { name: "주문 탭으로 이동" }));
    expect(screen.getByTestId("location-path").textContent).toBe(
      "/customers/customer-1",
    );
    expect(screen.getByTestId("location-search").textContent).toBe("");
    expect(
      within(dialog).getByText("저장하지 않은 토큰 조정을 버릴까요?"),
    ).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "계속 편집" }));
    expect(
      (within(dialog).getByLabelText("조정 수량") as HTMLInputElement).value,
    ).toBe("5");
    expect(screen.getByTestId("location-path").textContent).toBe(
      "/customers/customer-1",
    );

    await user.click(
      screen.getByRole("button", { name: "주문 목록으로 이동" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "변경 버리기" }),
    );

    expect(
      await screen.findByRole("heading", { name: "주문 목록", level: 1 }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("dialog", { name: "홍길동 고객 토큰 조정" }),
    ).toBeNull();
  });
});

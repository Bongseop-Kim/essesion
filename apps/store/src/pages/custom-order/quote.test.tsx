// @vitest-environment jsdom

import type { MeResponse } from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ createQuote: vi.fn() }));

vi.mock("@essesion/api-client/query", () => ({
  createQuoteMutation: () => ({ mutationFn: api.createQuote }),
  listAddressesOptions: () => ({
    queryKey: ["addresses"],
    queryFn: async () => [{ id: "address-1" }],
  }),
  listMyQuotesQueryKey: () => ["my-quotes"],
}));

// 배송지 UI는 이 페이지의 관심사가 아니다 — 자체 조회를 끌고 오지 않게 대체한다.
vi.mock("@/features/shipping/ui/address-select-modal", () => ({
  AddressSelectModal: () => null,
}));
vi.mock("@/features/shipping/ui/shipping-address-card", () => ({
  ShippingAddressCard: ({ address }: { address: { id: string } | null }) => (
    <div>{address ? `배송지 ${address.id}` : "배송지 없음"}</div>
  ),
}));
vi.mock("@/shared/lib/analytics", () => ({ trackEvent: vi.fn() }));

import { DEFAULT_CUSTOM_ORDER_OPTIONS } from "@/features/custom-order/model/options";
import { useSession } from "@/shared/store/session";

import { CustomQuotePage } from "./quote";

function user(overrides: Partial<MeResponse>): MeResponse {
  return {
    id: "user-a",
    name: "홍길동",
    email: "buyer@example.com",
    phone: "01012345678",
    phone_verified: true,
    birth: null,
    role: "customer",
    notification_enabled: true,
    notification_consent: true,
    marketing_kakao_sms_consent: false,
    created_at: "2026-07-13T00:00:00.000Z",
    ...overrides,
  };
}

const DRAFT = {
  options: {
    ...DEFAULT_CUSTOM_ORDER_OPTIONS,
    quantity: 40,
    tieWidth: 8,
    additionalNotes: " 로고는 대검 아래 ",
  },
  imageRefs: [{ object_key: "uploads/quote_request/a.png", part: "blade" }],
  totalCost: 480_000,
};

function renderPage(state: unknown = { customQuote: DRAFT }) {
  render(
    <MemoryRouter initialEntries={[{ pathname: "/custom-order/quote", state }]}>
      <QueryClientProvider client={new QueryClient()}>
        <Routes>
          <Route path="/custom-order/quote" element={<CustomQuotePage />} />
          <Route path="/custom-order" element={<p>주문서</p>} />
          <Route path="/my-page/quote-request" element={<p>견적 목록</p>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const field = (label: string | RegExp) =>
  screen.getByLabelText(label) as HTMLInputElement;

describe("CustomQuotePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.createQuote.mockResolvedValue({});
    sessionStorage.clear();
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

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useSession.setState({ status: "anonymous", accessToken: null, user: null });
  });

  it("회원 정보로 연락처를 채우고 주문서에서 고른 사양 그대로 접수한다", async () => {
    useSession.setState({
      status: "authenticated",
      accessToken: "access",
      user: user({}),
    });
    renderPage();

    expect(field(/담당자 성함/).value).toBe("홍길동");
    expect(field(/^연락처/).value).toBe("01012345678");
    await screen.findByText("배송지 address-1");

    fireEvent.click(screen.getByRole("button", { name: "견적 요청하기" }));

    await screen.findByText("견적 목록");
    expect(api.createQuote).toHaveBeenCalledTimes(1);
    expect(api.createQuote.mock.calls[0]?.[0].body).toMatchObject({
      shipping_address_id: "address-1",
      quantity: 40,
      contact_name: "홍길동",
      contact_method: "phone",
      contact_value: "01012345678",
      additional_notes: "로고는 대검 아래",
      reference_images: DRAFT.imageRefs,
      // 화면 값이 아니라 서버용으로 정리된 사양이 나간다
      options: { tie_type: "", interlining: "WOOL", tie_width: 8 },
    });
  });

  it("전화번호가 없으면 이메일로, 아무 정보도 없으면 빈칸이고 빈칸으로는 접수하지 않는다", async () => {
    useSession.setState({
      status: "authenticated",
      accessToken: "access",
      user: user({ phone: null }),
    });
    renderPage();
    expect(field(/이메일 주소/).value).toBe("buyer@example.com");
    cleanup();

    useSession.setState({
      status: "authenticated",
      accessToken: "access",
      user: user({ name: "", phone: null, email: null }),
    });
    renderPage();
    expect(field(/담당자 성함/).value).toBe("");
    expect(field(/이메일 주소/).value).toBe("");
    await screen.findByText("배송지 address-1");

    fireEvent.click(screen.getByRole("button", { name: "견적 요청하기" }));

    await waitFor(() =>
      expect(screen.getByText("담당자 성함을 입력해 주세요.")).toBeTruthy(),
    );
    expect(api.createQuote).not.toHaveBeenCalled();
  });

  it("초안 없이 들어오면(새로고침·직접 진입) 주문서로 돌려보낸다", () => {
    useSession.setState({
      status: "authenticated",
      accessToken: "access",
      user: user({}),
    });
    renderPage(null);
    expect(screen.getByText("주문서")).toBeTruthy();
  });
});

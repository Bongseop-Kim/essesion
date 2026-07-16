// @vitest-environment jsdom

import type { MeResponse } from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/auth", () => ({
  useAuthGuard: () => ({ requireAuth: vi.fn(() => false) }),
}));

vi.mock("@/features/design/ui/design-picker", () => ({
  DesignPicker: () => null,
}));

vi.mock("@/features/custom-order", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/custom-order")>();
  return {
    ...actual,
    useCustomQuote: () => ({
      data: { total_cost: 100_000, sewing_cost: 60_000, fabric_cost: 40_000 },
      isCurrent: true,
      isError: false,
      refetch: vi.fn(),
    }),
  };
});

import {
  DEFAULT_CUSTOM_ORDER_OPTIONS,
  DEFAULT_QUOTE_CONTACT,
  readCustomOrderFormDraft,
  saveCustomOrderFormDraft,
} from "@/features/custom-order";
import { useSession } from "@/shared/store/session";

import { CustomOrderPage } from "./index";

function user(id: string): MeResponse {
  return {
    id,
    name: `user-${id}`,
    email: `${id}@example.com`,
    phone: null,
    phone_verified: false,
    birth: null,
    role: "customer",
    notification_enabled: true,
    notification_consent: true,
    marketing_kakao_sms_consent: false,
    created_at: "2026-07-13T00:00:00.000Z",
  };
}

describe("custom order draft account boundary", () => {
  beforeEach(() => {
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

  it("stale A 사용자가 남은 loading 중에는 A draft를 렌더하거나 저장하지 않는다", async () => {
    saveCustomOrderFormDraft("user-a", {
      options: { ...DEFAULT_CUSTOM_ORDER_OPTIONS, quantity: 100 },
      contact: { ...DEFAULT_QUOTE_CONTACT, contactName: "account-a-secret" },
    });
    useSession.setState({
      status: "loading",
      accessToken: "access-b",
      user: user("user-a"),
    });
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <MemoryRouter initialEntries={["/custom-order"]}>
        <QueryClientProvider client={queryClient}>
          <CustomOrderPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(screen.queryByDisplayValue("account-a-secret")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "100개" }));
    expect(
      (screen.getByLabelText("수량 직접 입력") as HTMLInputElement).value,
    ).toBe("100");
    const contactName = await screen.findByLabelText(/담당자 성함/);
    expect((contactName as HTMLInputElement).value).toBe("");
    fireEvent.change(contactName, {
      target: { value: "edited-during-loading" },
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 450));
    });

    expect(readCustomOrderFormDraft("user-a")?.contact.contactName).toBe(
      "account-a-secret",
    );
    expect(readCustomOrderFormDraft(null)).toBeNull();
    queryClient.clear();
  });
});

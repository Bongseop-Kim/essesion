import type { PricingValueOut } from "@essesion/api-client";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../test/render-admin-page";

const api = vi.hoisted(() => ({
  getPricing: vi.fn(),
  updatePricing: vi.fn(),
}));

vi.mock("@essesion/api-client/query", () => ({
  getAdminPricingOptions: () => ({
    queryKey: ["pricing"],
    queryFn: api.getPricing,
  }),
  getAdminPricingQueryKey: () => ["pricing"],
  updateAdminPricingMutation: () => ({ mutationFn: api.updatePricing }),
}));

vi.mock("../shared/session/admin-session", () => ({
  useAdminSession: () => ({
    state: {
      status: "authenticated",
      session: { userId: "admin-1", displayName: "운영자", role: "admin" },
    },
  }),
}));

vi.mock("../shared/lib/use-dirty-form-blocker", () => ({
  useDirtyFormBlocker: () => ({ state: "unblocked" }),
}));

import { PricingPage } from "./pricing";

const pricing: PricingValueOut = {
  key: "sample_shipping_fee",
  category: "샘플",
  description: "샘플 배송비",
  amount: 1_000,
  unit: "원",
  updated_at: "2026-07-12T01:00:00Z",
  updated_by: "admin-1",
};

function pendingPromise() {
  return new Promise<never>(() => undefined);
}

function renderPage() {
  const { queryClient } = renderAdminPage(<PricingPage />);
  return queryClient;
}

async function editAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  const amount = await screen.findByLabelText("sample_shipping_fee");
  await user.clear(amount);
  await user.type(amount, "1200");
  await user.type(screen.getByLabelText(/변경 사유/), "배송비 정책 변경");
  await user.click(screen.getByRole("button", { name: "변경 내용 확인" }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "저장" }));
  return amount as HTMLInputElement;
}

describe("PricingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValue("00000000-0000-4000-8000-000000000002");
  });

  it("로딩 중에도 가격 관리 route heading을 유지한다", () => {
    api.getPricing.mockReturnValue(pendingPromise());
    renderPage();

    expect(
      screen.getByRole("heading", { name: "가격 관리", level: 1 }),
    ).toBeTruthy();
    expect(screen.getByText("가격 설정을 불러오고 있습니다")).toBeTruthy();
  });

  it("pending 중 입력을 잠그고 실패 뒤에는 가격·사유·멱등 키를 보존한다", async () => {
    const user = userEvent.setup();
    let rejectMutation: ((error: Error) => void) | undefined;
    api.getPricing.mockResolvedValue([pricing]);
    api.updatePricing.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectMutation = reject;
      }),
    );
    renderPage();

    const amount = await editAndConfirm(user);

    await waitFor(() => expect(api.updatePricing).toHaveBeenCalledTimes(1));
    expect(amount.disabled).toBe(true);
    expect(api.updatePricing).toHaveBeenCalledWith(
      {
        body: {
          operation_id: "00000000-0000-4000-8000-000000000001",
          reason: "배송비 정책 변경",
          items: [
            {
              key: "sample_shipping_fee",
              amount: 1_200,
              expected_updated_at: pricing.updated_at,
            },
          ],
        },
      },
      expect.anything(),
    );

    await act(async () => rejectMutation?.(new Error("동시 수정 충돌")));

    expect(await screen.findByText("동시 수정 충돌")).toBeTruthy();
    expect(amount.value).toBe("1200");
    expect(
      (screen.getByLabelText(/변경 사유/) as HTMLTextAreaElement).value,
    ).toBe("배송비 정책 변경");
    expect(
      screen.getByText(/operation 00000000-0000-4000-8000-000000000001/),
    ).toBeTruthy();
  });

  it("성공 시 가격 쿼리를 무효화하고 최신 값으로 편집 상태를 정리한다", async () => {
    const user = userEvent.setup();
    const updated = {
      ...pricing,
      amount: 1_200,
      updated_at: "2026-07-12T02:00:00Z",
    };
    api.getPricing
      .mockResolvedValueOnce([pricing])
      .mockResolvedValue([updated]);
    api.updatePricing.mockResolvedValue([updated]);
    const queryClient = renderPage();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await editAndConfirm(user);

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["pricing"] }),
    );
    expect(await screen.findByText("변경한 가격이 없습니다.")).toBeTruthy();
    expect(
      (screen.getByLabelText(/변경 사유/) as HTMLTextAreaElement).value,
    ).toBe("");
  });

  it("편집 중 캐시가 갱신되어도 편집 시작 revision으로 저장한다", async () => {
    const user = userEvent.setup();
    api.getPricing.mockResolvedValue([pricing]);
    api.updatePricing.mockRejectedValue(new Error("동시 수정 충돌"));
    const queryClient = renderPage();

    await screen.findByLabelText("sample_shipping_fee");
    await user.clear(screen.getByLabelText("sample_shipping_fee"));
    await user.type(screen.getByLabelText("sample_shipping_fee"), "1200");
    await user.type(screen.getByLabelText(/변경 사유/), "배송비 정책 변경");

    act(() => {
      queryClient.setQueryData(
        ["pricing"],
        [
          {
            ...pricing,
            amount: 1_100,
            updated_at: "2026-07-12T02:00:00Z",
          },
        ],
      );
    });

    await user.click(screen.getByRole("button", { name: "변경 내용 확인" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "저장",
      }),
    );

    await waitFor(() =>
      expect(api.updatePricing).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            items: [
              expect.objectContaining({
                expected_updated_at: pricing.updated_at,
              }),
            ],
          }),
        }),
        expect.anything(),
      ),
    );
  });
});

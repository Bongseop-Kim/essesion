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
  // 페이지는 CATEGORY_TABS에 있는 category만 렌더한다 — 기본 탭(reform)에 배치
  category: "reform",
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
  await user.click(await screen.findByRole("button", { name: "가격 수정" }));
  const amount = await screen.findByLabelText("sample_shipping_fee");
  await user.clear(amount);
  await user.type(amount, "1200");
  await user.type(screen.getByLabelText(/변경 사유/), "배송비 정책 변경");
  await user.click(screen.getByRole("button", { name: "변경 1건 검토" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText(/1,000원 → 1,200원/)).toBeTruthy();
  expect(within(dialog).getByText(/신규 주문 계산부터 적용/)).toBeTruthy();
  expect(within(dialog).getByText("배송비 정책 변경")).toBeTruthy();
  await user.click(
    within(dialog).getByRole("button", { name: "가격 1건 적용" }),
  );
  return amount as HTMLInputElement;
}

describe("PricingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002")
      .mockReturnValue("00000000-0000-4000-8000-000000000003");
  });

  it("로딩 중에도 가격 관리 route heading을 유지한다", () => {
    api.getPricing.mockReturnValue(pendingPromise());
    renderPage();

    expect(
      screen.getByRole("heading", { name: "가격 관리", level: 1 }),
    ).toBeTruthy();
    expect(screen.getByText("가격 설정을 불러오고 있습니다")).toBeTruthy();
  });

  it("기본 화면은 읽기 전용이고 명시적으로 가격 수정을 시작한다", async () => {
    const user = userEvent.setup();
    api.getPricing.mockResolvedValue([pricing]);
    renderPage();

    expect(await screen.findByText("1,000원")).toBeTruthy();
    expect(screen.queryByLabelText("sample_shipping_fee")).toBeNull();
    expect(screen.queryByLabelText(/변경 사유/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "가격 수정" }));
    expect(await screen.findByLabelText("sample_shipping_fee")).toBeTruthy();
    expect(screen.getByLabelText(/변경 사유/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "편집 취소" }));
    expect(screen.queryByLabelText("sample_shipping_fee")).toBeNull();
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
          operation_id: "00000000-0000-4000-8000-000000000002",
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
      screen.queryByText(/00000000-0000-4000-8000-000000000002/),
    ).toBeNull();
  });

  it("실패한 동일 요청은 같은 작업 ID로 재시도하고 입력 변경 시 새 ID를 사용한다", async () => {
    const user = userEvent.setup();
    api.getPricing.mockResolvedValue([pricing]);
    api.updatePricing.mockRejectedValue(new Error("일시적인 저장 실패"));
    renderPage();

    await editAndConfirm(user);
    expect(await screen.findByText("일시적인 저장 실패")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "변경 1건 검토" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "가격 1건 적용",
      }),
    );
    await waitFor(() => expect(api.updatePricing).toHaveBeenCalledTimes(2));

    const firstOperationId =
      api.updatePricing.mock.calls[0]?.[0].body.operation_id;
    const retryOperationId =
      api.updatePricing.mock.calls[1]?.[0].body.operation_id;
    expect(retryOperationId).toBe(firstOperationId);
    expect(firstOperationId).toBe("00000000-0000-4000-8000-000000000002");

    const amount = screen.getByLabelText("sample_shipping_fee");
    await user.clear(amount);
    await user.type(amount, "1300");
    expect(screen.queryByText("일시적인 저장 실패")).toBeNull();

    await user.click(screen.getByRole("button", { name: "변경 1건 검토" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "가격 1건 적용",
      }),
    );
    await waitFor(() => expect(api.updatePricing).toHaveBeenCalledTimes(3));
    expect(api.updatePricing.mock.calls[2]?.[0].body.operation_id).toBe(
      "00000000-0000-4000-8000-000000000003",
    );
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
    const setQueryData = vi.spyOn(queryClient, "setQueryData");

    await editAndConfirm(user);

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["pricing"] }),
    );
    expect(setQueryData).toHaveBeenCalledWith(["pricing"], [updated]);
    expect(
      await screen.findByRole("button", { name: "가격 수정" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/변경 사유/)).toBeNull();
    expect(screen.getByText("1,200원")).toBeTruthy();
  });

  it("편집 중 캐시가 갱신되어도 편집 시작 revision으로 저장한다", async () => {
    const user = userEvent.setup();
    api.getPricing.mockResolvedValue([pricing]);
    api.updatePricing.mockRejectedValue(new Error("동시 수정 충돌"));
    const queryClient = renderPage();

    await user.click(await screen.findByRole("button", { name: "가격 수정" }));
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

    await user.click(screen.getByRole("button", { name: "변경 1건 검토" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "가격 1건 적용",
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

import type { PaymentIncidentDetailOut } from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getIncident: vi.fn(),
  reconcile: vi.fn(),
  resolve: vi.fn(),
}));
const session = vi.hoisted(() => ({ role: "admin" as "admin" | "manager" }));

vi.mock("@essesion/api-client/query", () => ({
  adminGetPaymentIncidentOptions: (_options: unknown) => ({
    queryKey: ["incident"],
    queryFn: api.getIncident,
  }),
  adminGetPaymentIncidentQueryKey: (_options: unknown) => ["incident"],
  adminListPaymentIncidentsQueryKey: () => ["incidents"],
  adminReconcilePaymentIncidentMutation: () => ({ mutationFn: api.reconcile }),
  adminResolvePaymentIncidentMutation: () => ({ mutationFn: api.resolve }),
}));

vi.mock("../../shared/session/admin-session", () => ({
  useAdminSession: () => ({
    state: {
      status: "authenticated",
      session: {
        userId: "admin-1",
        displayName: "운영자",
        role: session.role,
      },
    },
  }),
}));

import { IncidentDetailPage } from "./detail";

const incident: PaymentIncidentDetailOut = {
  id: "incident-1",
  operation_id: "source-operation-1",
  incident_type: "amount_mismatch",
  status: "open",
  request_id: "request-1",
  actor_id: "actor-1",
  order_id: "order-1",
  order_number: "ORDER-001",
  claim_id: "claim-1",
  claim_number: "CL-001",
  expected_amount: 30_000,
  observed_amount: 20_000,
  details: { toss_status: "DONE", safe_reason: "amount mismatch" },
  resolution_memo: null,
  resolved_by: null,
  resolved_at: null,
  created_at: "2026-07-12T01:00:00Z",
  updated_at: "2026-07-12T01:00:00Z",
  admin_actions: [
    {
      kind: "reconcile",
      label: "외부 상태 대사",
      enabled: true,
    },
    {
      kind: "resolve",
      label: "해결 처리",
      enabled: true,
      destructive: true,
      requires_memo: true,
    },
  ],
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/incidents/incident-1"]}>
        <Routes>
          <Route
            path="/incidents/:incidentId"
            element={<IncidentDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("IncidentDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.role = "admin";
    api.getIncident.mockResolvedValue(incident);
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001",
    );
  });

  it("대사는 위험 확인 전에는 실행하지 않는다", async () => {
    const user = userEvent.setup();
    api.reconcile.mockResolvedValueOnce(incident);
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "외부 상태 대사" }),
    );
    await user.click(screen.getByRole("button", { name: "확인 후 실행" }));
    expect(api.reconcile).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "실행" }));

    await waitFor(() =>
      expect(api.reconcile).toHaveBeenCalledWith(
        {
          path: { incident_id: "incident-1" },
        },
        expect.anything(),
      ),
    );
  });

  it("403 실패 후에도 해결 메모와 동일한 멱등 키를 보존한다", async () => {
    const user = userEvent.setup();
    api.resolve.mockRejectedValueOnce({
      detail: "최고 관리자 권한이 필요합니다.",
    });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "해결 처리" }));
    const memo = screen.getByLabelText("해결 근거 (필수)");
    await user.type(memo, "Toss 승인 금액과 원장 금액 불일치 확인");
    await user.click(screen.getByRole("button", { name: "확인 후 실행" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "실행" }));

    await waitFor(() =>
      expect(api.resolve).toHaveBeenCalledWith(
        {
          path: { incident_id: "incident-1" },
          body: {
            operation_id: "00000000-0000-4000-8000-000000000001",
            memo: "Toss 승인 금액과 원장 금액 불일치 확인",
          },
        },
        expect.anything(),
      ),
    );
    expect(
      await screen.findByText("최고 관리자 권한이 필요합니다."),
    ).toBeTruthy();
    expect((memo as HTMLTextAreaElement).value).toBe(
      "Toss 승인 금액과 원장 금액 불일치 확인",
    );
  });

  it("매니저에게는 조회 근거만 제공하고 실행 버튼을 숨긴다", async () => {
    session.role = "manager";
    renderPage();

    expect(
      await screen.findByText("최고 관리자 권한이 필요합니다"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "외부 상태 대사" })).toBeNull();
    expect(screen.queryByRole("button", { name: "해결 처리" })).toBeNull();
  });
});

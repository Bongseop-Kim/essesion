import type { PaymentIncidentDetailOut } from "@essesion/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

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

vi.mock("../../shared/lib/use-dirty-form-blocker", () => ({
  useDirtyFormBlocker: () => ({ state: "unblocked" }),
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
  return renderAdminPage(
    <Routes>
      <Route path="/incidents/:incidentId" element={<IncidentDetailPage />} />
    </Routes>,
    { entry: "/incidents/incident-1" },
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

    expect(await screen.findByText("₩10,000 차이")).toBeTruthy();
    expect(
      screen.getByText("확인 금액이 기대 금액보다 ₩10,000 부족합니다"),
    ).toBeTruthy();
    expect(screen.getByText("-₩10,000")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "외부 상태 대사" }));
    await user.click(
      screen.getByRole("button", { name: "외부 상태 대사 검토" }),
    );
    expect(api.reconcile).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "외부 상태 대사" }),
    );

    await waitFor(() =>
      expect(api.reconcile).toHaveBeenCalledWith(
        {
          path: { incident_id: "incident-1" },
        },
        expect.anything(),
      ),
    );
  });

  it("작업 초안이 열리면 다른 액션 선택을 막고 입력을 보존한다", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "해결 처리" }));
    await user.type(screen.getByLabelText("해결 근거 (필수)"), "확인 중");

    expect(
      (
        screen.getByRole("button", {
          name: "외부 상태 대사",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "해결 처리" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("해결 근거 (필수)") as HTMLTextAreaElement).value,
    ).toBe("확인 중");
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
    await user.click(screen.getByRole("button", { name: "해결 처리 검토" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "해결 처리" }));

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

  it("해결 실패 뒤 근거를 바꾸면 새 멱등 키를 사용한다", async () => {
    const user = userEvent.setup();
    vi.mocked(crypto.randomUUID)
      .mockReset()
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000000")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValue("00000000-0000-4000-8000-000000000002");
    api.resolve.mockRejectedValue(new Error("해결 충돌"));
    renderPage();

    await user.click(await screen.findByRole("button", { name: "해결 처리" }));
    await user.type(
      screen.getByLabelText("해결 근거 (필수)"),
      "Toss 대사 결과 확인",
    );
    await user.click(screen.getByRole("button", { name: "해결 처리 검토" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "해결 처리",
      }),
    );
    expect(await screen.findByText("해결 충돌")).toBeTruthy();

    await user.type(screen.getByLabelText("해결 근거 (필수)"), " 완료");
    await user.click(screen.getByRole("button", { name: "해결 처리 검토" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "해결 처리",
      }),
    );

    await waitFor(() => expect(api.resolve).toHaveBeenCalledTimes(2));
    expect(api.resolve.mock.calls[0]?.[0].body.operation_id).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(api.resolve.mock.calls[1]?.[0].body.operation_id).toBe(
      "00000000-0000-4000-8000-000000000002",
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

  it("원 JSON과 기술 식별자를 기본으로 접어 둔다", async () => {
    const user = userEvent.setup();
    renderPage();

    const trigger = await screen.findByRole("button", { name: "기술 정보" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "기술 정보" })).toBeNull();

    await user.click(trigger);

    const region = screen.getByRole("region", { name: "기술 정보" });
    expect(within(region).getByText(/"request_id": "request-1"/)).toBeTruthy();
    expect(within(region).getByText(/"toss_status": "DONE"/)).toBeTruthy();
  });
});

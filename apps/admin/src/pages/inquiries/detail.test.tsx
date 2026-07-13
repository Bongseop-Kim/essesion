import type { AdminInquiryDetailOut } from "@essesion/api-client";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({ get: vi.fn(), answer: vi.fn() }));

vi.mock("@essesion/api-client/query", () => ({
  getAdminInquiryOptions: () => ({ queryKey: ["inquiry"], queryFn: api.get }),
  getAdminInquiryQueryKey: () => ["inquiry"],
  listAdminInquiriesQueryKey: () => ["inquiries"],
  answerAdminInquiryMutation: () => ({ mutationFn: api.answer }),
}));

vi.mock("../../shared/lib/use-dirty-form-blocker", () => ({
  useDirtyFormBlocker: () => ({ state: "unblocked" }),
}));

import { InquiryDetailPage } from "./detail";

const inquiry: AdminInquiryDetailOut = {
  id: "inquiry-1",
  title: "배송 문의",
  category: "일반",
  content: "언제 배송되나요?",
  status: "답변대기",
  answer: null,
  answer_date: null,
  answered_by: null,
  answer_actor: null,
  created_at: "2026-07-12T01:00:00Z",
  updated_at: "2026-07-12T01:00:00Z",
  customer: { id: "customer-1", name: "홍길동", email: null, phone: null },
  product: null,
};

function renderPage() {
  return renderAdminPage(
    <Routes>
      <Route path="/inquiries/:inquiryId" element={<InquiryDetailPage />} />
    </Routes>,
    { entry: "/inquiries/inquiry-1" },
  );
}

describe("InquiryDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue(inquiry);
  });

  it("stale 오류에 작성 답변을 유지하고 중복 mutation payload에 revision을 포함한다", async () => {
    const user = userEvent.setup();
    api.answer.mockRejectedValue(new Error("다른 관리자가 먼저 답변했습니다."));
    renderPage();

    const field = await screen.findByRole("textbox", { name: /^답변/ });
    await user.type(field, "내일 출고 예정입니다.");
    await user.click(screen.getByRole("button", { name: "답변 확인" }));
    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText("답변을 저장하지 못했습니다")).toBeTruthy();
    expect(
      (screen.getByRole("textbox", { name: /^답변/ }) as HTMLTextAreaElement)
        .value,
    ).toBe("내일 출고 예정입니다.");
    await waitFor(() =>
      expect(api.answer).toHaveBeenCalledWith(
        {
          path: { inquiry_id: inquiry.id },
          body: {
            expected_updated_at: inquiry.updated_at,
            answer: "내일 출고 예정입니다.",
          },
        },
        expect.anything(),
      ),
    );
  });

  it("편집 중 캐시가 갱신되어도 편집 시작 revision으로 답변한다", async () => {
    const user = userEvent.setup();
    api.answer.mockRejectedValue(new Error("동시 수정 충돌"));
    const { queryClient } = renderPage();

    const field = await screen.findByRole("textbox", { name: /^답변/ });
    await user.type(field, "내일 출고 예정입니다.");
    act(() => {
      queryClient.setQueryData(["inquiry"], {
        ...inquiry,
        answer: "다른 관리자의 답변",
        updated_at: "2026-07-12T02:00:00Z",
      });
    });

    await user.click(screen.getByRole("button", { name: "답변 확인" }));
    await user.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() =>
      expect(api.answer).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            expected_updated_at: inquiry.updated_at,
          }),
        }),
        expect.anything(),
      ),
    );
  });
});

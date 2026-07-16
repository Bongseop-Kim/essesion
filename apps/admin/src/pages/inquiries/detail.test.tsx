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

  it("기본 화면은 답변을 읽기 전용으로 두고 명시적 작성 버튼만 제공한다", async () => {
    renderPage();

    await screen.findByRole("heading", { name: "배송 문의", level: 1 });
    expect(screen.queryByRole("textbox", { name: /^답변/ })).toBeNull();
    expect(screen.getByRole("button", { name: "답변 작성" })).toBeTruthy();
    expect(screen.getByText("아직 등록된 답변이 없습니다.")).toBeTruthy();
  });

  it("답변 수정 취소 시 기존 읽기 전용 답변으로 복귀한다", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({
      ...inquiry,
      status: "답변완료",
      answer: "오늘 출고했습니다.",
      answer_date: "2026-07-12T02:00:00Z",
      answered_by: "admin-1",
      answer_actor: { id: "admin-1", name: "운영자", email: null },
    });
    renderPage();

    expect(await screen.findByText("오늘 출고했습니다.")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /^답변/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "답변 수정" }));
    const field = screen.getByRole("textbox", {
      name: /^답변/,
    }) as HTMLTextAreaElement;
    await user.clear(field);
    await user.type(field, "내일 출고합니다.");
    await user.click(screen.getByRole("button", { name: "편집 취소" }));

    expect(screen.queryByRole("textbox", { name: /^답변/ })).toBeNull();
    expect(screen.getByText("오늘 출고했습니다.")).toBeTruthy();
  });

  it("미리보기 뒤 구체적인 버튼으로 저장하고 stale 오류에도 작성 답변을 유지한다", async () => {
    const user = userEvent.setup();
    api.answer.mockRejectedValue(new Error("다른 관리자가 먼저 답변했습니다."));
    renderPage();

    await screen.findByRole("heading", { name: "배송 문의", level: 1 });
    await user.click(screen.getByRole("button", { name: "답변 작성" }));
    const field = screen.getByRole("textbox", { name: /^답변/ });
    await user.type(field, "내일 출고 예정입니다.");
    await user.click(screen.getByRole("button", { name: "답변 미리보기" }));
    expect(screen.getByText("내일 출고 예정입니다.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "답변 등록" }));

    expect(await screen.findByText("답변을 저장하지 못했습니다")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "내용 수정" }));
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

    await screen.findByRole("heading", { name: "배송 문의", level: 1 });
    await user.click(screen.getByRole("button", { name: "답변 작성" }));
    const field = screen.getByRole("textbox", { name: /^답변/ });
    await user.type(field, "내일 출고 예정입니다.");
    act(() => {
      queryClient.setQueryData(["inquiry"], {
        ...inquiry,
        answer: "다른 관리자의 답변",
        updated_at: "2026-07-12T02:00:00Z",
      });
    });

    await user.click(screen.getByRole("button", { name: "답변 미리보기" }));
    await user.click(screen.getByRole("button", { name: "답변 등록" }));

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

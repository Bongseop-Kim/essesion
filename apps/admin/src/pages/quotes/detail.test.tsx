import type { AdminQuoteDetailOut } from "@essesion/api-client";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  readImage: vi.fn(),
}));

vi.mock("@essesion/api-client/query", () => ({
  getAdminQuoteOptions: () => ({ queryKey: ["quote"], queryFn: api.get }),
  getAdminQuoteQueryKey: () => ["quote"],
  listAdminQuotesQueryKey: () => ["quotes"],
  updateAdminQuoteStatusMutation: () => ({ mutationFn: api.update }),
  createAdminQuoteImageReadUrlMutation: () => ({ mutationFn: api.readImage }),
}));

vi.mock("../../shared/lib/use-dirty-form-blocker", () => ({
  useDirtyFormBlocker: () => ({ state: "unblocked" }),
}));

import { QuoteDetailPage } from "./detail";

const quote: AdminQuoteDetailOut = {
  id: "quote-1",
  quote_number: "Q-001",
  status: "요청",
  quantity: 100,
  business_name: "테스트 상사",
  quoted_amount: null,
  created_at: "2026-07-12T01:00:00Z",
  updated_at: "2026-07-12T01:00:00Z",
  customer: {
    id: "customer-1",
    name: "홍길동",
    email: "customer@example.com",
    phone: "01012345678",
  },
  admin_actions: [
    {
      target_status: "견적발송",
      label: "견적발송(으)로 변경",
      enabled: true,
    },
  ],
  shipping_address_id: null,
  shipping_address: null,
  options: { fabric_type: "SILK" },
  additional_notes: "빠른 납기",
  contact_name: "홍길동",
  contact_method: "phone",
  contact_value: "01012345678",
  quote_conditions: null,
  admin_memo: null,
  images: [],
  status_logs: [],
};

function renderPage(entry = "/quote-requests/quote-1") {
  return renderAdminPage(
    <Routes>
      <Route path="/quote-requests/:quoteId" element={<QuoteDetailPage />} />
    </Routes>,
    { entry },
  );
}

describe("QuoteDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue(quote);
  });

  it("관계 ID로 참고 이미지 URL을 발급하고 실패한 재발급을 알린다", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({
      ...quote,
      images: [
        {
          id: "image-1",
          content_type: "image/webp",
          size_bytes: 1024,
          created_at: "2026-07-12T01:00:00Z",
        },
      ],
    });
    api.readImage
      .mockResolvedValueOnce({ read_url: "https://private.example/quote.webp" })
      .mockRejectedValueOnce(new Error("만료된 이미지"));
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "참고 이미지" }));
    await user.click(
      await screen.findByRole("button", { name: "이미지 보기" }),
    );
    expect(
      (await screen.findByAltText("견적 참고 자료")).getAttribute("src"),
    ).toBe("https://private.example/quote.webp");
    expect(api.readImage).toHaveBeenLastCalledWith(
      { path: { quote_id: quote.id, image_id: "image-1" } },
      expect.anything(),
    );

    await user.click(screen.getByRole("button", { name: "URL 재발급" }));
    expect(
      await screen.findByText("이미지를 불러오지 못했습니다"),
    ).toBeTruthy();
    expect(api.readImage).toHaveBeenCalledTimes(2);
  });

  it("stale 오류에도 금액·조건 입력과 expected_updated_at을 보존한다", async () => {
    const user = userEvent.setup();
    api.update.mockRejectedValue(new Error("최신 내용을 다시 확인해 주세요."));
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "견적 작성·발송" }),
    );
    await user.type(screen.getByLabelText("견적 금액"), "120000");
    await user.type(screen.getByLabelText("견적 조건"), "배송비 포함");
    await user.click(screen.getByRole("button", { name: "변경 내용 확인" }));
    await user.click(
      screen.getByRole("button", { name: "견적발송 상태로 변경" }),
    );

    expect(await screen.findByText("견적을 변경하지 못했습니다")).toBeTruthy();
    expect((screen.getByLabelText("견적 금액") as HTMLInputElement).value).toBe(
      "120000",
    );
    expect(
      (screen.getByLabelText("견적 조건") as HTMLTextAreaElement).value,
    ).toBe("배송비 포함");
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            expected_updated_at: quote.updated_at,
            new_status: "견적발송",
            quoted_amount: 120000,
          }),
        }),
        expect.anything(),
      ),
    );
  });

  it("액션 편집 중 캐시가 갱신되어도 선택 시점 revision으로 변경한다", async () => {
    const user = userEvent.setup();
    api.update.mockRejectedValue(new Error("동시 수정 충돌"));
    const { queryClient } = renderPage();

    await user.click(
      await screen.findByRole("button", { name: "견적 작성·발송" }),
    );
    await user.type(screen.getByLabelText("견적 금액"), "120000");
    act(() => {
      queryClient.setQueryData(["quote"], {
        ...quote,
        quoted_amount: 110000,
        updated_at: "2026-07-12T02:00:00Z",
      });
    });

    await user.click(screen.getByRole("button", { name: "변경 내용 확인" }));
    await user.click(
      screen.getByRole("button", { name: "견적발송 상태로 변경" }),
    );

    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            expected_updated_at: quote.updated_at,
          }),
        }),
        expect.anything(),
      ),
    );
  });

  it("제작 옵션 원문을 기술 정보에서만 펼쳐 보여준다", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "제작 사양" }));
    expect(screen.getByText("원단")).toBeTruthy();
    expect(screen.getByText("실크")).toBeTruthy();
    const trigger = await screen.findByRole("button", { name: "기술 정보" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "기술 정보" })).toBeNull();

    await user.click(trigger);

    expect(
      within(screen.getByRole("region", { name: "기술 정보" })).getByText(
        /"fabric_type": "SILK"/,
      ),
    ).toBeTruthy();
  });

  it("상세 탭을 URL로 복원하고 첫 화면에 진행 단계와 작업을 둔다", async () => {
    renderPage("/quote-requests/quote-1?tab=proposal");

    expect(
      await screen.findByRole("tabpanel", { name: "견적 제안" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("현재 단계 요청")).toBeTruthy();
    expect(screen.getByRole("button", { name: "견적 작성·발송" })).toBeTruthy();
  });
});

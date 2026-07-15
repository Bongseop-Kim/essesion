import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pickDate } from "../../test/pickers";
import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@essesion/api-client/query", () => ({
  createManualOrderMutation: () => ({ mutationFn: api.create }),
  listManualOrdersQueryKey: () => ["manual-orders"],
}));

vi.mock("../../shared/lib/use-dirty-form-blocker", () => ({
  useDirtyFormBlocker: () => ({ state: "unblocked" }),
}));

import { ManualOrderNewPage } from "./new";

function renderPage() {
  renderAdminPage(
    <Routes>
      <Route path="/manual-orders/new" element={<ManualOrderNewPage />} />
      <Route path="/manual-orders/:manualOrderId" element={<p>등록 완료</p>} />
    </Routes>,
    { entry: "/manual-orders/new" },
  );
}

describe("ManualOrderNewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.create.mockResolvedValue({ id: "manual-order-1" });
  });

  it("작업지시서 내용을 생성 SDK payload로 저장하고 상세로 이동한다", async () => {
    const user = userEvent.setup();
    renderPage();

    await pickDate(user, /날짜/, "2026-07-15");
    await user.type(screen.getByLabelText(/이름/), " 홍길동 ");
    await user.type(screen.getByLabelText(/휴대폰/), "01012345678");
    await user.type(screen.getByLabelText("주소"), "서울시 중구 테스트로 1");
    await user.type(screen.getByLabelText(/금액/), "30000");
    await user.click(screen.getByRole("checkbox", { name: "접수" }));

    await user.click(screen.getByRole("checkbox", { name: "자동수선" }));
    await user.click(screen.getByRole("radio", { name: "돌려묶기" }));
    await user.click(screen.getByRole("radio", { name: "딤플" }));
    await user.type(screen.getByLabelText(/\[자동\] 총장/), "145");
    await user.click(screen.getByRole("checkbox", { name: "폭수선" }));
    await user.type(screen.getByLabelText(/\[폭\] 폭/), "8.5");
    await user.type(screen.getByLabelText("특이사항"), "지퍼 교체 요청");

    await user.click(screen.getByRole("button", { name: "수기 주문 등록" }));

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith(
        {
          body: {
            order_date: "2026-07-15",
            customer_name: "홍길동",
            phone: "01012345678",
            address: "서울시 중구 테스트로 1",
            amount: 30000,
            shipping_fee: 0,
            is_received: true,
            is_paid: false,
            is_confirmed: false,
            items: [
              {
                quantity: 1,
                automatic: {
                  mechanism: "zipper",
                  turn_knot: true,
                  dimple: true,
                  total_length_cm: 145,
                },
                width: { target_width_cm: 8.5 },
                restoration: null,
                note: "지퍼 교체 요청",
              },
            ],
          },
        },
        expect.anything(),
      ),
    );
    expect(await screen.findByText("등록 완료")).toBeTruthy();
  });

  it("끈 타입을 선택하면 돌려묶기가 해제되고 비활성화된다", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("checkbox", { name: "자동수선" }));
    await user.click(screen.getByRole("radio", { name: "돌려묶기" }));
    await user.click(screen.getByRole("radio", { name: "끈" }));

    const turnKnot = screen.getByRole("radio", { name: "돌려묶기" });
    expect((turnKnot as HTMLInputElement).checked).toBe(false);
    expect((turnKnot as HTMLInputElement).disabled).toBe(true);
    expect(
      (screen.getByRole("radio", { name: "방" }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("필수값이 없으면 제출을 차단한다", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "수기 주문 등록" }));

    expect(
      await screen.findByText("입력한 주문 내용을 확인해 주세요"),
    ).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();
  });
});

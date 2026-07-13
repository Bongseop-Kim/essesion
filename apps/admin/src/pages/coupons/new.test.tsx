import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@essesion/api-client/query", () => ({
  createAdminCouponMutation: () => ({ mutationFn: api.create }),
  listAdminCouponsQueryKey: () => ["coupons"],
}));

vi.mock("../../shared/lib/use-dirty-form-blocker", () => ({
  useDirtyFormBlocker: () => ({ state: "unblocked" }),
}));

import { CouponNewPage } from "./new";

function renderPage() {
  renderAdminPage(
    <Routes>
      <Route path="/coupons/new" element={<CouponNewPage />} />
      <Route path="/coupons/:couponId" element={<p>등록 완료</p>} />
    </Routes>,
    { entry: "/coupons/new" },
  );
}

describe("CouponNewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.create.mockResolvedValue({ id: "coupon-1" });
  });

  it("정액 쿠폰 조건을 생성 SDK payload로 저장하고 상세로 이동한다", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/관리용 쿠폰 이름/), " 신규 쿠폰 ");
    await user.type(screen.getByLabelText("고객 표시 이름"), "신규 할인");
    await user.click(screen.getByRole("radio", { name: "정액 할인" }));
    await user.type(screen.getByLabelText(/할인 금액/), "3000");
    await user.type(screen.getByLabelText(/만료일 \(KST\)/), "2027-12-31");
    await user.type(screen.getByLabelText("쿠폰 설명"), "신규 고객 할인");
    await user.click(screen.getByRole("button", { name: "쿠폰 등록" }));

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith(
        {
          body: {
            name: "신규 쿠폰",
            display_name: "신규 할인",
            discount_type: "fixed",
            discount_value: 3000,
            max_discount_amount: null,
            expiry_date: "2027-12-31",
            description: "신규 고객 할인",
            additional_info: null,
            is_active: true,
          },
        },
        expect.anything(),
      ),
    );
    expect(await screen.findByText("등록 완료")).toBeTruthy();
  });

  it("실패하면 입력한 쿠폰 조건을 보존한다", async () => {
    const user = userEvent.setup();
    api.create.mockRejectedValueOnce(new Error("이름 충돌"));
    renderPage();

    const name = screen.getByLabelText(/관리용 쿠폰 이름/);
    await user.type(name, "중복 쿠폰");
    await user.type(screen.getByLabelText(/할인율/), "10");
    await user.type(screen.getByLabelText(/만료일 \(KST\)/), "2027-12-31");
    await user.click(screen.getByRole("button", { name: "쿠폰 등록" }));

    expect(await screen.findByText("이름 충돌")).toBeTruthy();
    expect((name as HTMLInputElement).value).toBe("중복 쿠폰");
  });

  it("유효하지 않은 제출은 첫 오류 필드로 focus를 이동한다", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "쿠폰 등록" }));

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByLabelText(/관리용 쿠폰 이름/),
      ),
    );
    expect(screen.getByText("입력한 쿠폰 조건을 확인해 주세요")).toBeTruthy();
  });
});

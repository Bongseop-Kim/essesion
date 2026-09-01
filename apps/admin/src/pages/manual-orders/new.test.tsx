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

import { ManualOrderNewPage, ManualRepairNewPage } from "./new";

function renderCustomPage() {
  renderAdminPage(
    <Routes>
      <Route path="/manual-orders/new" element={<ManualOrderNewPage />} />
      <Route path="/manual-orders/:manualOrderId" element={<p>등록 완료</p>} />
    </Routes>,
    { entry: "/manual-orders/new" },
  );
}

function renderRepairPage() {
  renderAdminPage(
    <Routes>
      <Route
        path="/manual-orders/repairs/new"
        element={<ManualRepairNewPage />}
      />
      <Route
        path="/manual-orders/repairs/:manualOrderId"
        element={<p>등록 완료</p>}
      />
    </Routes>,
    { entry: "/manual-orders/repairs/new" },
  );
}

async function fillOrderInfo(user: ReturnType<typeof userEvent.setup>) {
  await pickDate(user, /날짜/, "2026-07-15");
  await user.type(screen.getByLabelText(/이름/), "홍길동");
  await user.type(screen.getByLabelText(/휴대폰/), "01012345678");
  await user.type(screen.getByLabelText(/금액/), "30000");
}

describe("ManualRepairNewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.create.mockResolvedValue({ id: "manual-order-1" });
  });

  it("수선 대분류만 제공한다 — 주문제작은 등록 화면이 따로다", () => {
    renderRepairPage();

    expect(screen.getByRole("checkbox", { name: "자동수선" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "폭수선" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "복원수선" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "주문제작" })).toBeNull();
  });

  it("작업지시서 내용을 생성 SDK payload로 저장하고 상세로 이동한다", async () => {
    const user = userEvent.setup();
    renderRepairPage();

    await pickDate(user, /날짜/, "2026-07-15");
    await user.type(screen.getByLabelText(/이름/), " 홍길동 ");
    await user.type(screen.getByLabelText(/휴대폰/), "01012345678");
    await user.type(screen.getByLabelText("주소"), "서울시 중구 테스트로 1");
    await user.type(screen.getByLabelText(/금액/), "30000");
    expect((screen.getByLabelText(/휴대폰/) as HTMLInputElement).value).toBe(
      "010-1234-5678",
    );
    expect((screen.getByLabelText(/금액/) as HTMLInputElement).value).toBe(
      "30,000",
    );
    await user.click(screen.getByRole("checkbox", { name: "접수" }));

    await user.click(screen.getByRole("checkbox", { name: "자동수선" }));
    await user.click(screen.getByRole("radio", { name: "돌려묶기" }));
    await user.click(screen.getByRole("radio", { name: "딤플" }));
    await user.type(screen.getByLabelText(/\[자동\] 총장/), "145");
    await user.click(screen.getByRole("checkbox", { name: "폭수선" }));
    await user.type(screen.getByLabelText(/\[폭\] 폭/), "8.5");
    await user.type(screen.getByLabelText("특이사항"), "지퍼 교체 요청");

    await user.click(screen.getByRole("button", { name: "수기 수선 등록" }));

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith(
        {
          body: {
            order_date: "2026-07-15",
            customer_name: "홍길동",
            phone: "01012345678",
            address: "서울시 중구 테스트로 1",
            amount: 30000,
            discount: 0,
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
                // 제작 스펙은 이 화면에서 만들 수 없다.
                custom: null,
                note: "지퍼 교체 요청",
                image_upload_ids: [],
              },
            ],
            image_upload_ids: [],
          },
        },
        expect.anything(),
      ),
    );
    expect(await screen.findByText("등록 완료")).toBeTruthy();
  });

  it("끈 타입을 선택하면 딤플이 해제되고 비활성화된다(돌려묶기는 유지)", async () => {
    const user = userEvent.setup();
    renderRepairPage();

    await user.click(screen.getByRole("checkbox", { name: "자동수선" }));
    await user.click(screen.getByRole("radio", { name: "딤플" }));
    await user.click(screen.getByRole("radio", { name: "끈" }));

    const dimple = screen.getByRole("radio", { name: "딤플" });
    expect((dimple as HTMLInputElement).checked).toBe(false);
    expect((dimple as HTMLInputElement).disabled).toBe(true);
    const turnKnot = screen.getByRole("radio", { name: "돌려묶기" });
    expect((turnKnot as HTMLInputElement).checked).toBe(true);
    expect((turnKnot as HTMLInputElement).disabled).toBe(false);
  });

  it("딤플을 선택하면 돌려묶기가 켜지고 방을 고를 수 없다", async () => {
    const user = userEvent.setup();
    renderRepairPage();

    await user.click(screen.getByRole("checkbox", { name: "자동수선" }));
    await user.click(screen.getByRole("radio", { name: "딤플" }));

    expect(
      (screen.getByRole("radio", { name: "돌려묶기" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByRole("radio", { name: "방" }) as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it("앞 품목을 삭제해도 뒤 품목의 입력 DOM을 유지한다", async () => {
    const user = userEvent.setup();
    renderRepairPage();

    await user.click(screen.getByRole("button", { name: "품목 추가" }));
    const notes = screen.getAllByLabelText("특이사항");
    const secondNote = notes[1]!;
    await user.type(notes[0]!, "첫 품목");
    await user.type(secondNote, "둘째 품목");

    await user.click(screen.getAllByRole("button", { name: "삭제" })[0]!);

    expect(screen.getByLabelText("특이사항")).toBe(secondNote);
    expect(
      (screen.getByLabelText("특이사항") as HTMLTextAreaElement).value,
    ).toBe("둘째 품목");
  });

  it("대분류를 고르지 않으면 제출을 차단한다", async () => {
    const user = userEvent.setup();
    renderRepairPage();

    await fillOrderInfo(user);
    await user.click(screen.getByRole("button", { name: "수기 수선 등록" }));

    expect(
      await screen.findByText("대분류를 하나 이상 선택해 주세요."),
    ).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();
  });
});

describe("ManualOrderNewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.create.mockResolvedValue({ id: "manual-order-1" });
  });

  it("제작 입력만 제공한다 — 수선 대분류가 없다", () => {
    renderCustomPage();

    expect(screen.queryByRole("checkbox", { name: "자동수선" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "폭수선" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "복원수선" })).toBeNull();
    expect(screen.getByLabelText("[제작] 내용")).toBeTruthy();
  });

  it("대분류 선택 없이 custom payload를 보낸다", async () => {
    const user = userEvent.setup();
    renderCustomPage();

    await fillOrderInfo(user);

    await user.click(screen.getByRole("radio", { name: "실크" }));
    await user.click(screen.getByRole("radio", { name: "선염" }));
    await user.click(screen.getByRole("radio", { name: "자동" }));
    await user.click(screen.getByRole("radio", { name: "돌려묶기" }));
    await user.click(screen.getByRole("radio", { name: "딤플" }));
    await user.click(screen.getByRole("radio", { name: "아동용" }));
    await user.type(screen.getByLabelText(/\[제작\] 타이 폭/), "7.5");
    await user.type(screen.getByLabelText("[제작] 내용"), "로고 자수");

    await user.click(screen.getByRole("button", { name: "수기 주문 등록" }));

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            items: [
              {
                quantity: 1,
                // 수선 스펙은 이 화면에서 만들 수 없다.
                automatic: null,
                width: null,
                restoration: null,
                custom: {
                  fabric_provided: false,
                  fabric_type: "SILK",
                  design_type: "YARN_DYED",
                  tie_type: "AUTO",
                  dimple: true,
                  turn_knot: true,
                  size_type: "CHILD",
                  tie_width_cm: 7.5,
                  memo: "로고 자수",
                },
                note: "",
                image_upload_ids: [],
              },
            ],
          }),
        }),
        expect.anything(),
      ),
    );
    expect(await screen.findByText("등록 완료")).toBeTruthy();
  });

  it("수동 봉제를 선택하면 [제작] 돌려묶기·딤플이 해제되고 비활성화된다", async () => {
    const user = userEvent.setup();
    renderCustomPage();

    await user.click(screen.getByRole("radio", { name: "자동" }));
    await user.click(screen.getByRole("radio", { name: "돌려묶기" }));
    await user.click(screen.getByRole("radio", { name: "딤플" }));
    await user.click(screen.getByRole("radio", { name: "수동" }));

    const turnKnot = screen.getByRole("radio", { name: "돌려묶기" });
    const dimple = screen.getByRole("radio", { name: "딤플" });
    expect((turnKnot as HTMLInputElement).checked).toBe(false);
    expect((turnKnot as HTMLInputElement).disabled).toBe(true);
    expect((dimple as HTMLInputElement).checked).toBe(false);
    expect((dimple as HTMLInputElement).disabled).toBe(true);
  });

  it("필수값이 없으면 제출을 차단한다", async () => {
    const user = userEvent.setup();
    renderCustomPage();

    await user.click(screen.getByRole("button", { name: "수기 주문 등록" }));

    expect(
      await screen.findByText("입력한 주문 내용을 확인해 주세요"),
    ).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();
  });
});

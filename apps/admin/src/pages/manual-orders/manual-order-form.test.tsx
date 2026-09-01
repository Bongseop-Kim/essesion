import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

vi.mock("../../shared/lib/use-dirty-form-blocker", () => ({
  useDirtyFormBlocker: () => ({ state: "unblocked" }),
}));

import { emptyManualOrderDraft, ManualOrderForm } from "./manual-order-form";

/** 화면 분리 전에 섞여 저장된 주문 — 제작으로 분류되지만 품목엔 custom이 없다. */
function legacyRepairOnlyItemDraft() {
  const draft = emptyManualOrderDraft("custom");
  return {
    ...draft,
    items: draft.items.map((item) => ({
      ...item,
      hasCustom: false,
      hasRestoration: true,
    })),
  };
}

describe("ManualOrderForm", () => {
  it("제작 화면이라도 custom이 없는 품목엔 제작 입력을 그리지 않는다", () => {
    // 그리면 itemBody가 custom: null로 보내 편집이 조용히 사라진다.
    renderAdminPage(
      <ManualOrderForm
        kind="custom"
        initial={legacyRepairOnlyItemDraft()}
        resetSignal={0}
        submitLabel="변경 저장"
        pending={false}
        onSubmit={() => {}}
      />,
    );

    expect(screen.queryByLabelText("주문제작 원단 준비")).toBeNull();
  });

  it("custom이 있는 품목엔 제작 입력을 그린다", () => {
    renderAdminPage(
      <ManualOrderForm
        kind="custom"
        initial={emptyManualOrderDraft("custom")}
        resetSignal={0}
        submitLabel="등록"
        pending={false}
        onSubmit={() => {}}
      />,
    );

    expect(screen.getByLabelText("주문제작 원단 준비")).toBeTruthy();
  });
});

// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { customOptionItems } from "./custom-option-items";
import { DetailList } from "./detail-list";

// 스토어가 보내는 주문 제작 사양 전체 — customOrderApiOptions
const CUSTOM = {
  fabric_provided: false,
  reorder: false,
  point: null,
  fabric_type: "SILK",
  design_type: "YARN_DYED",
  tie_type: "",
  interlining: "WOOL",
  size_type: "ADULT",
  tie_width: 8.5,
  triangle_stitch: true,
  side_stitch: true,
  bar_tack: false,
  fold7: false,
  dimple: false,
  turn_knot: false,
  spoderato: false,
  brand_label: false,
  care_label: false,
};

function renderItems(options: unknown) {
  render(<DetailList items={customOptionItems(options)} />);
}
const labels = () =>
  [...document.querySelectorAll("dt")].map((node) => node.textContent);
const state = (option: string) =>
  screen.queryAllByText(new RegExp(`^${option} 선택(됨| 안 됨)$`))[0]
    ?.textContent;

describe("customOptionItems", () => {
  afterEach(cleanup);

  it("고른 선택지와 안 고른 선택지를 함께 보여 준다", () => {
    renderItems(CUSTOM);

    expect(state("실크")).toBe("실크 선택됨");
    expect(state("수동 타이")).toBe("수동 타이 선택됨");
    expect(state("자동 타이")).toBe("자동 타이 선택 안 됨");
    expect(state("울")).toBe("울 선택됨");
    expect(state("없음")).toBe("없음 선택됨");
    expect(state("삼각 봉제")).toBe("삼각 봉제 선택됨");
    expect(state("바택")).toBe("바택 선택 안 됨");
    expect(state("케어 라벨")).toBe("케어 라벨 선택 안 됨");
    expect(screen.getByText("8.5cm")).toBeTruthy();
    // 수동 타이에는 없는 옵션이다
    expect(labels()).not.toContain("[자동] 옵션");
  });

  it("자동 타이면 딤플·돌려묶기를, 수동이라도 고른 값이 있으면 숨기지 않는다", () => {
    renderItems({ ...CUSTOM, tie_type: "AUTO", turn_knot: true });
    expect(state("돌려묶기")).toBe("돌려묶기 선택됨");
    expect(state("딤플")).toBe("딤플 선택 안 됨");
    cleanup();

    renderItems({ ...CUSTOM, tie_type: "", turn_knot: true });
    expect(labels()).toContain("[자동] 옵션");
    expect(state("돌려묶기")).toBe("돌려묶기 선택됨");
  });

  it("없는 키는 안 고름으로 그리지 않는다 — 샘플 주문에는 봉제 옵션이 없다", () => {
    renderItems({
      fabric_type: null,
      design_type: null,
      tie_type: null,
      interlining: "POLY",
    });

    expect(labels()).toEqual(["원단", "디자인 방식", "넥타이 방식", "심지"]);
    // 봉제 샘플은 원단을 고르지 않는다
    expect(screen.getAllByText("해당 없음")).toHaveLength(2);
    expect(state("수동 타이")).toBe("수동 타이 선택됨");
    expect(state("폴리")).toBe("폴리 선택됨");
  });

  it("포인트 주문은 포인트·타이 방식·라벨만 보이고, 예전에 받은 옵션은 숨기지 않는다", () => {
    renderItems({
      ...CUSTOM,
      point: "EMBROIDERY",
      fabric_provided: true,
      fabric_type: null,
      design_type: null,
      interlining: "",
      size_type: null,
      tie_width: null,
      triangle_stitch: false,
      side_stitch: false,
      brand_label: true,
    });
    expect(labels()).toEqual([
      "주문 구분",
      "포인트",
      "넥타이 방식",
      "봉제·마감",
    ]);
    expect(state("자수")).toBe("자수 선택됨");
    expect(state("브랜드 라벨")).toBe("브랜드 라벨 선택됨");
    expect(state("케어 라벨")).toBe("케어 라벨 선택 안 됨");
    expect(state("삼각 봉제")).toBeUndefined();
    cleanup();

    // 제한 전에 접수된 포인트 주문 — 돈을 받은 옵션은 그대로 보인다
    renderItems({ ...CUSTOM, point: "HEAT_TRANSFER", fabric_provided: true });
    expect(labels()).toContain("심지");
    expect(labels()).toContain("사이즈");
    expect(state("삼각 봉제")).toBe("삼각 봉제 선택됨");
    expect(state("바택")).toBeUndefined();
    expect(labels()).not.toContain("원단 제공");
    cleanup();

    // 포인트 주문의 딤플·돌려묶기는 선택지가 아니다 — 예전에 고른 것만 보인다
    renderItems({
      ...CUSTOM,
      point: "EMBROIDERY",
      tie_type: "AUTO",
      dimple: true,
    });
    expect(state("딤플")).toBe("딤플 선택됨");
    expect(state("돌려묶기")).toBeUndefined();
  });

  it("모르는 키·값은 글자로 남기고 기술 키는 숨긴다", () => {
    renderItems({
      fabric_type: "LINEN",
      lining_color: "navy",
      fabric: "silk",
      object_key: "uploads/custom_order/private.png",
    });

    expect(screen.getByText("LINEN")).toBeTruthy();
    // 문자열이 아닌 값도 화면을 깨지 않고 글자로 나온다
    cleanup();
    renderItems({ tie_type: { toString: "x" }, reorder: "maybe" });
    expect(screen.getByText('{"toString":"x"}')).toBeTruthy();
    expect(screen.getByText("maybe")).toBeTruthy();
    cleanup();
    renderItems({
      fabric_type: "LINEN",
      lining_color: "navy",
      fabric: "silk",
      object_key: "uploads/custom_order/private.png",
    });
    expect(screen.getByText("lining color")).toBeTruthy();
    expect(screen.getByText("navy")).toBeTruthy();
    expect(screen.getByText("실크")).toBeTruthy();
    expect(document.body.textContent).not.toContain("uploads/");
  });
});

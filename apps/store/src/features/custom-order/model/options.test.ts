import { describe, expect, it } from "vitest";

import {
  customOrderApiOptions,
  customOrderSummary,
  DEFAULT_CUSTOM_ORDER_OPTIONS,
  invalidCustomOrderSection,
  invalidQuoteContact,
} from "./options";

describe("custom order options", () => {
  it("넥타이 폭은 빈 값으로 시작하고 계산 요청에는 null로 전달한다", () => {
    expect(DEFAULT_CUSTOM_ORDER_OPTIONS.tieWidth).toBe("");
    expect(
      customOrderApiOptions(DEFAULT_CUSTOM_ORDER_OPTIONS).tie_width,
    ).toBeNull();
    expect(invalidCustomOrderSection(DEFAULT_CUSTOM_ORDER_OPTIONS)?.field).toBe(
      "tieWidth",
    );
  });

  it("재주문도 선택한 원단을 서버 과금 옵션으로 전달한다", () => {
    expect(
      customOrderApiOptions({
        ...DEFAULT_CUSTOM_ORDER_OPTIONS,
        reorder: true,
      }),
    ).toMatchObject({
      fabric_provided: false,
      reorder: true,
      fabric_type: "POLY",
      design_type: "YARN_DYED",
    });
  });

  it("자수·열전사는 원단 없이 포인트만 서버로 보내고 재주문과 함께 고를 수 있다", () => {
    const options = {
      ...DEFAULT_CUSTOM_ORDER_OPTIONS,
      reorder: true,
      pointEnabled: true,
      pointType: "HEAT_TRANSFER" as const,
    };
    expect(customOrderApiOptions(options)).toMatchObject({
      // 원단비 0은 point만으로 계산된다 — "고객 제공"으로 읽히지 않게 false로 보낸다
      fabric_provided: false,
      reorder: true,
      point: "HEAT_TRANSFER",
      fabric_type: null,
      design_type: null,
    });
    expect(customOrderSummary(options)).toEqual(
      expect.arrayContaining([
        { label: "원단", value: "재주문 · 정해진 원단" },
        { label: "포인트", value: "열전사 필름" },
      ]),
    );
  });

  it("포인트 주문은 타이 방식·라벨만 보내고 숨은 칸으로 제출을 막지 않는다", () => {
    // 포인트를 켜기 전에 골라 둔 값 — state에는 남지만 서버로는 나가지 않는다
    const options = {
      ...DEFAULT_CUSTOM_ORDER_OPTIONS,
      fabricProvided: true,
      pointEnabled: true,
      tieType: "AUTO" as const,
      interlining: "WOOL" as const,
      sizeType: "CHILD" as const,
      tieWidth: 8,
      triangleStitch: true,
      sideStitch: true,
      barTack: true,
      fold7: true,
      dimple: true,
      turnKnot: true,
      spoderato: true,
      brandLabel: true,
      careLabel: true,
    };
    expect(customOrderApiOptions(options)).toEqual({
      fabric_provided: false,
      reorder: false,
      point: "EMBROIDERY",
      fabric_type: null,
      design_type: null,
      tie_type: "AUTO",
      interlining: "",
      size_type: null,
      tie_width: null,
      triangle_stitch: false,
      side_stitch: false,
      bar_tack: false,
      fold7: false,
      dimple: false,
      turn_knot: false,
      spoderato: false,
      brand_label: true,
      care_label: true,
    });
    const summary = customOrderSummary(options);
    expect(summary).toContainEqual({ label: "원단", value: "정해진 원단" });
    expect(summary).toContainEqual({ label: "타이", value: "자동 타이" });
    expect(summary.some((row) => row.label === "규격")).toBe(false);
    // 폭이 비어 있고 수동 타이에 딤플이 남아 있어도 막지 않는다
    expect(
      invalidCustomOrderSection({
        ...DEFAULT_CUSTOM_ORDER_OPTIONS,
        pointEnabled: true,
        dimple: true,
        turnKnot: true,
      }),
    ).toBeNull();
  });

  it("수동 타이의 딤플과 범위 밖 규격을 막는다", () => {
    expect(
      invalidCustomOrderSection({
        ...DEFAULT_CUSTOM_ORDER_OPTIONS,
        dimple: true,
      }),
    ).toEqual({
      section: "sewing",
      field: "dimple",
      message: "딤플은 자동 타이에서만 선택할 수 있습니다.",
    });
    expect(
      invalidCustomOrderSection({
        ...DEFAULT_CUSTOM_ORDER_OPTIONS,
        tieWidth: 12.5,
      })?.section,
    ).toBe("spec");
  });

  it("돌려묶기는 자동 타이에서만 허용하고 서버 옵션으로 전달한다", () => {
    expect(
      invalidCustomOrderSection({
        ...DEFAULT_CUSTOM_ORDER_OPTIONS,
        turnKnot: true,
      }),
    ).toEqual({
      section: "sewing",
      field: "turnKnot",
      message: "돌려묶기는 자동 타이에서만 선택할 수 있습니다.",
    });
    expect(
      customOrderApiOptions({
        ...DEFAULT_CUSTOM_ORDER_OPTIONS,
        tieType: "AUTO",
        turnKnot: true,
      }).turn_knot,
    ).toBe(true);
    // 딤플은 돌려묶기와 함께만 — 예전 임시저장 조합도 맞춰 보낸다
    expect(
      customOrderApiOptions({
        ...DEFAULT_CUSTOM_ORDER_OPTIONS,
        tieType: "AUTO",
        dimple: true,
        turnKnot: false,
      }).turn_knot,
    ).toBe(true);
    // 수동 타이의 예전 임시저장 딤플은 버리고 turn_knot도 강제하지 않는다
    expect(
      customOrderApiOptions({
        ...DEFAULT_CUSTOM_ORDER_OPTIONS,
        tieType: "MANUAL",
        dimple: true,
        turnKnot: false,
      }),
    ).toMatchObject({ dimple: false, turn_knot: false });
  });

  it("수량 상한과 견적 연락처 형식을 검증한다", () => {
    expect(
      invalidCustomOrderSection({
        ...DEFAULT_CUSTOM_ORDER_OPTIONS,
        quantity: 10_001,
      })?.field,
    ).toBe("quantity");
    const contact = {
      contactName: "홍길동",
      businessName: "",
      contactMethod: "email" as const,
      contactValue: "not-an-email",
    };
    expect(invalidQuoteContact(contact)?.field).toBe("contactValue");
    expect(invalidQuoteContact({ ...contact, contactName: " " })?.field).toBe(
      "contactName",
    );
    expect(
      invalidQuoteContact({ ...contact, contactValue: "buyer@example.com" }),
    ).toBeNull();
  });
});

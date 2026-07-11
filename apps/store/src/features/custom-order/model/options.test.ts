import { describe, expect, it } from "vitest";

import {
  customOrderApiOptions,
  DEFAULT_CUSTOM_ORDER_OPTIONS,
  invalidCustomOrderSection,
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
      design_type: "PRINTING",
    });
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
  });

  it("수량 상한과 견적 연락처 형식을 검증한다", () => {
    expect(
      invalidCustomOrderSection({
        ...DEFAULT_CUSTOM_ORDER_OPTIONS,
        quantity: 10_001,
      })?.field,
    ).toBe("quantity");
    expect(
      invalidCustomOrderSection(
        { ...DEFAULT_CUSTOM_ORDER_OPTIONS, quantity: 100, tieWidth: 8 },
        {
          contactName: "홍길동",
          businessName: "",
          contactMethod: "email",
          contactValue: "not-an-email",
        },
        true,
      )?.field,
    ).toBe("contactValue");
  });
});

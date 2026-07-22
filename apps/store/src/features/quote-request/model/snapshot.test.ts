import { describe, expect, it } from "vitest";

import { quoteCustomOrderOptions, quoteReferenceImageKeys } from "./snapshot";

describe("quote request snapshot", () => {
  it("저장된 snake_case 옵션을 주문 제작 요약 입력으로 복원한다", () => {
    expect(
      quoteCustomOrderOptions(
        {
          fabric_provided: true,
          reorder: true,
          fabric_type: "SILK",
          design_type: "YARN_DYED",
          tie_type: "AUTO",
          interlining: "WOOL",
          size_type: "CHILD",
          tie_width: 7.5,
          triangle_stitch: false,
          turn_knot: true,
        },
        120,
        "선물 포장",
      ),
    ).toMatchObject({
      fabricProvided: true,
      reorder: true,
      fabricType: "SILK",
      designType: "YARN_DYED",
      tieType: "AUTO",
      interlining: "WOOL",
      sizeType: "CHILD",
      tieWidth: 7.5,
      triangleStitch: false,
      turnKnot: true,
      quantity: 120,
      additionalNotes: "선물 포장",
    });
  });

  it("손상된 선택값은 안전한 기본값으로 표시한다", () => {
    expect(quoteCustomOrderOptions({}, 100, "")).toMatchObject({
      fabricProvided: false,
      fabricType: "POLY",
      designType: "PRINTING",
      tieType: "MANUAL",
      interlining: "POLY",
      sizeType: "ADULT",
      tieWidth: "",
      triangleStitch: true,
      sideStitch: true,
    });
  });

  it("유효한 참고 이미지 키만 중복 없이 반환한다", () => {
    expect(
      quoteReferenceImageKeys([
        { object_key: "quote/a.webp" },
        { object_key: " quote/b.webp " },
        { object_key: "quote/a.webp" },
        { url: "https://example.com/external.webp" },
        null,
      ]),
    ).toEqual(["quote/a.webp", "quote/b.webp"]);
  });
});

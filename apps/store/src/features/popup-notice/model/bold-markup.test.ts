import { describe, expect, it } from "vitest";

import { splitBold } from "./bold-markup";

describe("splitBold", () => {
  it("**로 감싼 구절만 굵게 나눈다", () => {
    expect(splitBold("연휴 기간 **택배사 휴무**로 멈춥니다.")).toEqual([
      { text: "연휴 기간 ", bold: false },
      { text: "택배사 휴무", bold: true },
      { text: "로 멈춥니다.", bold: false },
    ]);
  });

  it("짝이 맞지 않는 **는 원문 그대로 둔다", () => {
    expect(splitBold("굵게 **시작만")).toEqual([
      { text: "굵게 **시작만", bold: false },
    ]);
  });

  it("마크가 없으면 한 조각이다", () => {
    expect(splitBold("평문")).toEqual([{ text: "평문", bold: false }]);
  });
});

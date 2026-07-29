import { describe, expect, it } from "vitest";

import { getDesignWarningNotice } from "./warnings";

describe("getDesignWarningNotice", () => {
  it("부분 생성 원인과 해결 방향 한 건을 가장 먼저 안내한다", () => {
    expect(
      getDesignWarningNotice([
        "motif spacing_mm 3.2 snapped to 3.0",
        "color #ff0000 in colorway 'main' likely outside CMYK gamut",
        "partial: 1 candidate(s) available after de-dup (requested 4)",
      ]),
    ).toEqual({
      title: "후보를 1개만 만들었어요",
      description:
        "요청 조건으로는 서로 다른 시안을 충분히 만들기 어려웠어요. 조건을 조금 단순하게 하거나 후보 수를 줄여 다시 시도해 보세요.",
    });
  });

  it("인쇄 색역 경고만 있으면 색상 조정 방법을 안내한다", () => {
    expect(
      getDesignWarningNotice([
        "color #ff0000 in colorway 'main' likely outside CMYK gamut",
      ]),
    ).toEqual({
      title: "인쇄하면 색이 다르게 보일 수 있어요",
      description:
        "채도가 높은 색을 조금 낮추면 화면과 인쇄물의 차이를 줄일 수 있어요.",
    });
  });

  it("자동 보정·내부 처리·알 수 없는 경고는 노출하지 않는다", () => {
    expect(
      getDesignWarningNotice([
        "motif spacing_mm 3.2 snapped to 3.0",
        "preview upload skipped",
        "something unexpected",
      ]),
    ).toBeNull();
    expect(getDesignWarningNotice(undefined)).toBeNull();
  });
});

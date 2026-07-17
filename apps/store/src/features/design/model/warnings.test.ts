import { describe, expect, it } from "vitest";

import { localizeDesignWarnings } from "./warnings";

describe("localizeDesignWarnings", () => {
  it("워커 영문 경고를 한국어 안내로 변환한다", () => {
    expect(
      localizeDesignWarnings([
        "2 candidate variant(s) failed to render and were dropped",
        "diversity shortfall: 1 distinct layout(s) < required 2",
        "partial: 3 candidate(s) available after de-dup (requested 4)",
        "design 1 dropped: IntentInvalid('bad palette')",
        "color #ff0000 in colorway 'main' likely outside CMYK gamut",
        "preview upload skipped",
      ]),
    ).toEqual([
      "일부 시안이 렌더링에 실패해 제외됐어요.",
      "비슷한 구성이 많아 서로 다른 시안을 충분히 만들지 못했어요.",
      "요청한 4개 중 3개의 시안만 생성됐어요.",
      "일부 디자인이 조건에 맞지 않아 제외됐어요.",
      "일부 색상은 실제 인쇄에서 화면과 다르게 보일 수 있어요.",
      "일부 미리보기 저장을 건너뛰었어요. 시안 확인에는 영향이 없어요.",
    ]);
  });

  it("알 수 없는 경고는 일반 문구로 폴백하고 중복을 제거한다", () => {
    expect(
      localizeDesignWarnings([
        "something unexpected",
        "another unknown warning",
        "diversity shortfall: 1 distinct design(s) < required 2",
      ]),
    ).toEqual([
      "일부 결과 생성에 제약이 있었어요.",
      "비슷한 구성이 많아 서로 다른 시안을 충분히 만들지 못했어요.",
    ]);
  });

  it("경고가 없으면 빈 목록을 반환한다", () => {
    expect(localizeDesignWarnings(undefined)).toEqual([]);
    expect(localizeDesignWarnings([])).toEqual([]);
  });
});

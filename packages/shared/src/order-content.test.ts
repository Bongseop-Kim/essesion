import { describe, expect, it } from "vitest";

import { decodeOrderItemContent } from "./order-content";

describe("decodeOrderItemContent", () => {
  it("미지 옵션과 false 값을 버리지 않고 활성 마감만 태그로 분리한다", () => {
    expect(
      decodeOrderItemContent(
        "custom",
        {
          options: {
            fabric_type: "SILK",
            triangle_stitch: true,
            dimple: false,
            lining_color: "navy",
            custom_config: { width: 7.5 },
            custom_enabled: false,
            object_key: "uploads/custom/private.png",
          },
        },
        4,
      ),
    ).toEqual({
      typeLabel: "맞춤 제작",
      rows: [
        { label: "제작 수량", value: "4개" },
        { label: "원단", value: "실크" },
        { label: "lining color", value: "navy" },
        { label: "custom config", value: '{"width":7.5}' },
        { label: "custom enabled", value: "아니오" },
      ],
      tags: ["삼각 봉제"],
      memo: undefined,
    });
  });

  it("수선 사양과 복원 메모를 디코드한다", () => {
    expect(
      decodeOrderItemContent(
        "repair",
        {
          tie: {
            automatic: {
              mechanism: "zipper",
              wearer_height_cm: 175,
              dimple: true,
              turn_knot: true,
            },
            width: { target_width_cm: 7.5 },
            restoration: { memo: "  원형 유지  " },
          },
        },
        1,
      ),
    ).toEqual({
      typeLabel: "수선",
      rows: [
        { label: "자동 타이 방식", value: "지퍼" },
        { label: "착용자 키", value: "175cm" },
        { label: "희망 타이 폭", value: "7.5cm" },
      ],
      tags: ["딤플", "돌려묶기"],
      memo: "원형 유지",
    });
  });
});

import { describe, expect, it } from "vitest";

import { tieLayout } from "./tie-image";

// /images/tie.svg의 viewBox 비율.
const SILHOUETTE_ASPECT = 270.3 / 1283;

describe("tieLayout", () => {
  it("미리보기 CSS 기하(그림자 397×864, 마스크 316×600 @ top -58)와 같은 박스를 만든다", () => {
    // 폭 316 = TieCanvas의 프레임 폭이므로 CSS 픽셀 값과 직접 비교할 수 있다.
    const layout = tieLayout(316, SILHOUETTE_ASPECT);

    expect(layout.height).toBeCloseTo((316 * 864) / 397, 5);
    expect(layout.mask.y).toBeCloseTo(58, 5);
    expect(layout.mask.height).toBeCloseTo(600, 5);
    expect(layout.mask.width).toBe(316);
    expect(layout.tile).toBeCloseTo(316 * 0.16, 5);

    // mask-size: contain + mask-position: center — 높이로 맞고 가로 중앙.
    expect(layout.silhouette.height).toBeCloseTo(600, 5);
    expect(layout.silhouette.width).toBeCloseTo(600 * SILHOUETTE_ASPECT, 5);
    expect(layout.silhouette.x).toBeCloseTo(
      (316 - 600 * SILHOUETTE_ASPECT) / 2,
      5,
    );
    expect(layout.silhouette.y).toBeCloseTo(58, 5);
  });
});

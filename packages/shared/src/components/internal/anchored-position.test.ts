import { describe, expect, it } from "vitest";

import { positionAnchored } from "./anchored-position";

describe("positionAnchored", () => {
  it("top이 넘치면 bottom으로 배치하고 가로 overflow를 막는다", () => {
    expect(
      positionAnchored(
        { top: 8, right: 40, bottom: 48, left: 0, width: 40, height: 40 },
        { width: 160, height: 80 },
        { width: 800, height: 600 },
        {
          placement: "top",
          gutter: 4,
          overflowPadding: 16,
          arrow: { width: 12, height: 8, padding: 14 },
        },
      ),
    ).toMatchObject({ placement: "bottom", top: 60, left: 16, arrowX: 14 });
  });
});

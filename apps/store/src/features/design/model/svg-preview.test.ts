import { describe, expect, it } from "vitest";

import { svgToDataUri } from "./svg-preview";

describe("SVG preview helpers", () => {
  it("SVG를 원문 삽입 없이 복원 가능한 data URI로 인코딩한다", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#123" d="M0 0"/></svg>';
    const uri = svgToDataUri(svg);
    const encoded = uri.replace("data:image/svg+xml;charset=utf-8,", "");

    expect(uri).toContain("%3Csvg");
    expect(uri).toContain("%23123");
    expect(uri).not.toContain("<svg");
    expect(decodeURIComponent(encoded)).toBe(svg);
  });
});

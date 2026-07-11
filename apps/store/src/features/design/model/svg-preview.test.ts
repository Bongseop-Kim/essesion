import { describe, expect, it } from "vitest";

import { svgRepeatBackground, svgToDataUri } from "./svg-preview";

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

  it("CSS 종료 문자를 인코딩한 반복 배경 스타일을 만든다", () => {
    const svg = '<svg><text>");background-image:url(evil)</text></svg>';
    const style = svgRepeatBackground(svg);

    expect(style.backgroundRepeat).toBe("repeat");
    expect(style.backgroundImage).toMatch(/^url\("data:image\/svg\+xml/);
    expect(style.backgroundImage).not.toContain("</text>");
    expect(style.backgroundImage).not.toContain('");background-image');
    expect(style.backgroundImage.endsWith('")')).toBe(true);
  });
});

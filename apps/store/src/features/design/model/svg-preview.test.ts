import { describe, expect, it } from "vitest";

import { svgTileScale, svgTileStyle, svgToDataUri } from "./svg-preview";

function svgWithWidth(width: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}" viewBox="0 0 48 48"></svg>`;
}

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

  it("루트 width의 물리 폭에서 타일 배율을 읽는다 (scale 패치는 tile_mm이 캐리어)", () => {
    expect(svgTileScale(svgWithWidth("72mm"))).toBe(1.5);
    expect(svgTileScale(svgWithWidth("48mm"))).toBe(1);
  });

  it("width가 없거나 비정상이면 배율 1로 폴백한다", () => {
    expect(svgTileScale("<svg></svg>")).toBe(1);
    expect(svgTileScale(svgWithWidth("0mm"))).toBe(1);
    expect(svgTileScale("깨진 문자열")).toBe(1);
  });

  it("썸네일 타일은 배율을 반영하되 100%에서 캡한다", () => {
    expect(svgTileStyle(svgWithWidth("72mm")).backgroundSize).toBe("93% auto");
    // scale 2 → 124%는 타일 1장이 카드보다 커져 단색처럼 보인다 — 100%로 캡.
    expect(svgTileStyle(svgWithWidth("96mm")).backgroundSize).toBe("100% auto");
  });
});

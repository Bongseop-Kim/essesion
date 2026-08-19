import type { CSSProperties } from "react";

const SVG_DATA_URI_PREFIX = "data:image/svg+xml;charset=utf-8,";

function encodeUriCharacter(character: string) {
  return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
}

export function svgToDataUri(svg: string): string {
  const encoded = encodeURIComponent(svg).replace(
    /[!'()*]/g,
    encodeUriCharacter,
  );
  return `${SVG_DATA_URI_PREFIX}${encoded}`;
}

// 기본 tile_mm. scale 패치는 tile_mm을 배율 캐리어로 쓴다 — 배율이 SVG 자체에 실려
// 별도 API 필드 없이 모든 소비자가 같은 값을 본다(docs/api-spec/worker-engine.md).
const BASE_TILE_MM = 48;

/** SVG 루트 width="Nmm"의 실측 폭(mm) — 파싱 실패·비정상값은 null. */
export function svgTileWidthMm(svg: string): number | null {
  const width = Number.parseFloat(
    /<svg[^>]*\swidth="([\d.]+)mm"/.exec(svg)?.[1] ?? "",
  );
  return Number.isFinite(width) && width > 0 ? width : null;
}

/** SVG 루트 width="Nmm"에서 반복 배율(N/48)을 읽는다 — 파싱 실패·비정상값은 1. */
export function svgTileScale(svg: string): number {
  const width = svgTileWidthMm(svg);
  return width === null ? 1 : width / BASE_TILE_MM;
}

/** 정사각 타일 미리보기 — 시드 패턴이라 반복해 깔아야 무엇인지 읽힌다. */
export function svgTileStyle(svg: string): CSSProperties {
  // 배율은 100%에서 캡 — scale 1.6부터 타일 1장이 카드보다 커져 단색처럼 보인다.
  const size = Math.min(62 * svgTileScale(svg), 100);
  return {
    aspectRatio: 1,
    backgroundImage: `url(${JSON.stringify(svgToDataUri(svg))})`,
    backgroundRepeat: "repeat",
    backgroundSize: `${size}% auto`,
    backgroundPosition: "center",
  };
}

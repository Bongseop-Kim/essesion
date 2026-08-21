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

/**
 * 정사각 타일 미리보기 — 시드 패턴이라 반복해 깔아야 무엇인지 읽힌다.
 *
 * 크기는 %가 아니라 **정수 px**다. 두 가지를 동시에 해결한다:
 *   - 흰 선: %는 타일 폭이 소수 px가 되고 반복마다 반올림 위상이 달라져 경계에 부모
 *     배경이 비친다. 정수 px면 모든 경계가 정확히 px에 떨어진다(원점 정렬도 같은 이유).
 *   - 배율: px는 박스가 작을수록 상대적으로 더 확대돼 보인다 — 84px 모바일 카드가
 *     152px PC 카드보다 자동으로 더 크게 나온다(반응형 분기 없이).
 * 100% 캡은 타일이 박스를 넘지 않게 하고, 캡에 걸리면 타일 1장이 박스를 정확히 채워
 * 경계가 아예 없다.
 */
const PREVIEW_TILE_PX = 116;

export function svgTileStyle(svg: string): CSSProperties {
  // 배율이 극단적으로 작아도 0px(=타일 사라짐)로 내려가지 않게 1px 하한 — TieCanvas와 동일.
  const px = Math.max(1, Math.round(PREVIEW_TILE_PX * svgTileScale(svg)));
  const tile = `min(100%, ${px}px)`;
  return {
    aspectRatio: 1,
    backgroundImage: `url(${JSON.stringify(svgToDataUri(svg))})`,
    backgroundRepeat: "repeat",
    backgroundSize: `${tile} ${tile}`,
    backgroundPosition: "0 0",
  };
}

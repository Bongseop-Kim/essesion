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

/** 정사각 타일 미리보기 — 시드 패턴이라 반복해 깔아야 무엇인지 읽힌다. */
export function svgTileStyle(svg: string): CSSProperties {
  return {
    aspectRatio: 1,
    backgroundImage: `url(${JSON.stringify(svgToDataUri(svg))})`,
    backgroundRepeat: "repeat",
    backgroundSize: "62% auto",
    backgroundPosition: "center",
  };
}

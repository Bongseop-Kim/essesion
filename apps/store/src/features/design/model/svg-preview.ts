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

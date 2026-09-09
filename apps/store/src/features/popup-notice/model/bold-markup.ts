export type TextSegment = { text: string; bold: boolean };

/**
 * `**굵게**` 마크만 해석하는 최소 파서. HTML·마크다운은 받지 않는다.
 * 마크 짝이 맞지 않으면 원문을 그대로 돌려준다 — 운영자가 실수해도 글자가 사라지지 않는다.
 */
export function splitBold(text: string): TextSegment[] {
  const parts = text.split("**");
  if (parts.length % 2 === 0) return [{ text, bold: false }];
  return parts
    .map((part, index) => ({ text: part, bold: index % 2 === 1 }))
    .filter((segment) => segment.text !== "");
}

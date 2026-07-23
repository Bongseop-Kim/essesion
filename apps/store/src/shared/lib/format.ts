export const krw = new Intl.NumberFormat("ko-KR");

// 옵션 조합별로 포매터를 캐시한다 — 리스트 렌더에서 매 행마다 재생성하지 않도록.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function dateTimeFormatter(options: Intl.DateTimeFormatOptions) {
  const key = JSON.stringify(options);
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("ko-KR", options);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/**
 * ISO 문자열을 ko-KR로 포맷한다. 빈 값·파싱 실패 시 `fallback`을 반환.
 * 각 화면은 인라인 옵션만 넘기고, 파싱 가드·포매터 캐시는 여기 한곳에 둔다.
 */
export function formatDateTime(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
  fallback = "",
): string {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? fallback
    : dateTimeFormatter(options).format(date);
}

export function formatDate(iso: string): string {
  return formatDateTime(iso, { dateStyle: "medium" }, iso);
}

export const krw = new Intl.NumberFormat("ko-KR");

const dateMedium = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" });

export function formatDate(iso: string): string {
  return dateMedium.format(new Date(iso));
}

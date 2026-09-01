import type { ManualOrderOut } from "@essesion/api-client";

/**
 * 수기 주문의 계열. 등록·상세·수정 화면이 계열별로 나뉘어 있어 새로 만든 주문은
 * 제작·수선 중 하나다 — 폼이 다른 계열의 입력을 아예 렌더하지 않으므로 섞일 수 없다.
 */
export type ManualOrderKind = "custom" | "repair";

export const MANUAL_ORDER_KIND_LABEL: Record<ManualOrderKind, string> = {
  custom: "제작",
  repair: "수선",
};

/**
 * 품목에서 계열을 읽는다 — 대시보드 매출 분해와 같은 규칙(`docs/api-spec/domains.md` §10):
 * 주문제작 품목이 하나라도 있으면 제작이다. 화면 분리 전에 섞여 저장된 주문도
 * 이 규칙으로 한쪽에 배정된다.
 */
export function manualOrderKind(
  order: Pick<ManualOrderOut, "items">,
): ManualOrderKind {
  return order.items.some((item) => item.custom != null) ? "custom" : "repair";
}

/** 계열별 경로 — 수선은 `repairs` 세그먼트를 하나 더 갖는다. */
export function manualOrderPath(
  kind: ManualOrderKind,
  ...segments: string[]
): string {
  return [
    "/manual-orders",
    ...(kind === "repair" ? ["repairs"] : []),
    ...segments,
  ].join("/");
}

import { browserStorage } from "@/shared/lib/browser-storage";

/** 4단계 M2 결정: 접힘 상태는 온보딩과 같은 패턴으로 localStorage에 남긴다. */
export const MOTIF_PANEL_COLLAPSED_KEY = "design:motif-panel:collapsed";
export const HISTORY_CARD_COLLAPSED_KEY = "design:history-card:collapsed";

export function isPanelCollapsed(key: string): boolean {
  return browserStorage()?.getItem(key) === "1";
}

export function setPanelCollapsed(key: string, collapsed: boolean): void {
  try {
    const storage = browserStorage();
    if (collapsed) storage?.setItem(key, "1");
    else storage?.removeItem(key);
  } catch {
    // 브라우저가 저장소를 막아도 접힘은 세션 내에서 동작한다.
  }
}

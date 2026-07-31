import { browserStorage } from "@/shared/lib/browser-storage";

/** 4단계 M2 결정: 접힘 상태는 온보딩과 같은 패턴으로 localStorage에 남긴다. */
export const MOTIF_PANEL_COLLAPSED_KEY = "design:motif-panel:collapsed";

export function isMotifPanelCollapsed(): boolean {
  try {
    return browserStorage()?.getItem(MOTIF_PANEL_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMotifPanelCollapsed(collapsed: boolean): void {
  try {
    const storage = browserStorage();
    if (collapsed) storage?.setItem(MOTIF_PANEL_COLLAPSED_KEY, "1");
    else storage?.removeItem(MOTIF_PANEL_COLLAPSED_KEY);
  } catch {
    // 브라우저가 저장소를 막아도 접힘은 세션 내에서 동작한다.
  }
}

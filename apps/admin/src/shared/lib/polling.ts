const POLLING_INTERVAL_MS = 30_000;

export function activeAdminPollingInterval(
  hasActiveWork: boolean,
  visibility: DocumentVisibilityState = document.visibilityState,
) {
  return visibility === "visible" && hasActiveWork
    ? POLLING_INTERVAL_MS
    : false;
}

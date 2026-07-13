const POLLING_INTERVAL_MS = 30_000;

export function activeAdminPollingInterval(
  hasActiveWork: boolean,
  visibility: DocumentVisibilityState = document.visibilityState,
) {
  return visibility === "visible" && hasActiveWork
    ? POLLING_INTERVAL_MS
    : false;
}

export function generationPollingInterval(
  items: readonly { status: string }[] | undefined,
  visibility?: DocumentVisibilityState,
) {
  return activeAdminPollingInterval(
    items?.some((item) => ["queued", "processing"].includes(item.status)) ??
      false,
    visibility,
  );
}

export function incidentPollingInterval(
  items: readonly { status: string }[] | undefined,
  visibility?: DocumentVisibilityState,
) {
  return activeAdminPollingInterval(
    items?.some((item) => item.status === "open") ?? false,
    visibility,
  );
}

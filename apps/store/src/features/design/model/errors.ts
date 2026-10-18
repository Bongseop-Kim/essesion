import { isRecord } from "@/shared/lib/guards";

/** Preserve safe API detail messages for helper flows that do not use error-kind UI. */
export function designErrorMessage(error: unknown, fallback: string): string {
  if (isRecord(error) && typeof error.detail === "string") return error.detail;
  return fallback;
}

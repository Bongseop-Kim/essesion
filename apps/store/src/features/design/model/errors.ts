export type DesignErrorKind =
  | "insufficient_tokens"
  | "refund_pending"
  | "worker_rejected"
  | "finalize_quota_exhausted"
  | "conflict"
  | "upstream_error"
  | "unknown";

export const DESIGN_ERROR_MESSAGES: Record<DesignErrorKind, string> = {
  insufficient_tokens: "디자인 생성에 필요한 토큰이 부족해요.",
  refund_pending: "환불 심사 중에는 디자인을 생성할 수 없어요.",
  worker_rejected:
    "요청을 이해하지 못했어요. 프롬프트를 수정해 다시 시도해 주세요. 토큰은 자동으로 환불돼요.",
  // 서버 detail이 리셋까지 남은 시간을 함께 안내한다 — 이 문구는 폴백.
  finalize_quota_exhausted:
    "최근 24시간 실사화 한도를 모두 사용했어요. 잠시 후 다시 시도해 주세요.",
  conflict:
    "현재 디자인 상태에서는 요청을 완료할 수 없어요. 세션을 새로고침해 주세요.",
  upstream_error:
    "일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요. 토큰은 자동으로 환불돼요.",
  unknown: "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
};

const knownErrorKinds = new Set<DesignErrorKind>([
  "insufficient_tokens",
  "refund_pending",
  "worker_rejected",
  "finalize_quota_exhausted",
  "conflict",
  "upstream_error",
]);

export type DesignErrorFeedback = {
  kind: DesignErrorKind;
  code: string | null;
  detail: string | null;
  message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseDesignError(error: unknown): DesignErrorFeedback {
  const code =
    isRecord(error) && typeof error.code === "string" ? error.code : null;
  const detail =
    isRecord(error) && typeof error.detail === "string" ? error.detail : null;
  const kind =
    code && knownErrorKinds.has(code as DesignErrorKind)
      ? (code as DesignErrorKind)
      : "unknown";

  return {
    kind,
    code,
    detail,
    message: DESIGN_ERROR_MESSAGES[kind],
  };
}

/** Preserve safe API detail messages for helper flows that do not use error-kind UI. */
export function designErrorMessage(error: unknown, fallback: string): string {
  const detail = parseDesignError(error).detail;
  if (detail) return detail;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

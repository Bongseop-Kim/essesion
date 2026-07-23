import { isRecord } from "@/shared/lib/guards";

export type DesignErrorKind =
  | "insufficient_tokens"
  | "refund_pending"
  | "worker_rejected"
  | "authoring_invalid"
  | "constraint_conflict"
  | "reference_invalid"
  | "intent_invalid"
  | "candidate_invalid"
  | "semantic_mismatch"
  | "motif_input_conflict"
  | "finalize_quota_exhausted"
  | "conflict"
  | "upstream_error"
  | "unknown";

export const DESIGN_ERROR_MESSAGES: Record<DesignErrorKind, string> = {
  insufficient_tokens: "디자인 생성에 필요한 토큰이 부족해요.",
  refund_pending: "환불 심사 중에는 디자인을 생성할 수 없어요.",
  worker_rejected:
    "요청 내용을 조금 더 구체적으로 작성해 주세요. 실패한 요청의 토큰은 자동으로 환불돼요.",
  authoring_invalid:
    "같은 요청을 다시 시도하거나 내용을 조금 더 구체적으로 작성해 주세요. 실패한 요청의 토큰은 자동으로 환불돼요.",
  constraint_conflict:
    "선택한 색상과 패턴 설정을 함께 적용할 수 없어요. 설정을 조정해 다시 생성해 주세요. 실패한 요청의 토큰은 자동으로 환불돼요.",
  reference_invalid:
    "참고 이미지를 사용할 수 없어요. 이미지를 삭제하거나 다시 첨부해 주세요. 실패한 요청의 토큰은 자동으로 환불돼요.",
  intent_invalid:
    "선택한 디자인 정보를 처리할 수 없어요. 다른 디자인을 선택하거나 새로 생성해 주세요. 실패한 요청의 토큰은 자동으로 환불돼요.",
  candidate_invalid:
    "같은 요청을 다시 시도해 주세요. 실패한 요청의 토큰은 자동으로 환불돼요.",
  semantic_mismatch:
    "요청한 주제와 맞는 모티프를 확정하지 못했어요. 주제를 더 구체적으로 작성해 주세요. 실패한 요청의 토큰은 자동으로 환불돼요.",
  motif_input_conflict:
    "직접 선택한 모티프와 모티프 형태 참고 사진은 합쳐서 2개까지 사용할 수 있어요.",
  // 서버 detail이 리셋까지 남은 시간을 함께 안내한다 — 이 문구는 폴백.
  finalize_quota_exhausted:
    "최근 24시간 실사화 한도를 모두 사용했어요. 잠시 후 다시 시도해 주세요.",
  conflict:
    "현재 디자인 상태에서는 요청을 완료할 수 없어요. 세션을 새로고침해 주세요.",
  upstream_error:
    "일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요. 토큰은 자동으로 환불돼요.",
  unknown: "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
};

export type DesignErrorFeedback = {
  kind: DesignErrorKind;
  code: string | null;
  detail: string | null;
  message: string;
};

export function parseDesignError(error: unknown): DesignErrorFeedback {
  const code =
    isRecord(error) && typeof error.code === "string" ? error.code : null;
  const detail =
    isRecord(error) && typeof error.detail === "string" ? error.detail : null;
  const kind =
    code && Object.hasOwn(DESIGN_ERROR_MESSAGES, code)
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

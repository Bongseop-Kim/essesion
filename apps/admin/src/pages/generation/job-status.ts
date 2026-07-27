export const JOB_KINDS = ["finalize", "export"] as const;

export function jobKindLabel(kind: (typeof JOB_KINDS)[number]) {
  return kind === "finalize" ? "원단 최종화" : "파일 내보내기";
}

export const JOB_STATUSES = [
  "queued",
  "processing",
  "succeeded",
  "failed",
  "canceled",
] as const;

export const JOB_STATUS_LABELS: Readonly<
  Record<(typeof JOB_STATUSES)[number], string>
> = {
  queued: "대기",
  processing: "처리 중",
  succeeded: "성공",
  failed: "실패",
  canceled: "취소",
};

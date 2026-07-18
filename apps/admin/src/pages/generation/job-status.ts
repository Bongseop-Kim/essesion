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

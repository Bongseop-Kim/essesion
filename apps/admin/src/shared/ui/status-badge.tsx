import type { ClaimBadgeOut } from "@essesion/api-client";
import { Badge, claimBadge } from "@essesion/shared";

const positive = new Set([
  "완료",
  "배송완료",
  "sent",
  "resolved",
  "active",
  "succeeded",
  "success",
  "approved",
  "used",
  "safe",
  "DONE",
]);
const critical = new Set([
  "실패",
  "거부",
  "취소",
  "failed",
  "inactive",
  "error",
  "revoked",
  "unsafe",
  "rejected",
  "invalid",
  "CANCELED",
]);
const warning = new Set([
  "대기중",
  "답변대기",
  "접수",
  "pending",
  "open",
  "queued",
  "partial",
  "hold",
  "duplicate",
]);
const statusLabels: Readonly<Record<string, string>> = {
  active: "활성",
  inactive: "비활성",
  open: "미해결",
  resolved: "해결",
  pending: "대기 중",
  sent: "발송 완료",
  failed: "실패",
  skipped: "발송 생략",
  queued: "대기",
  processing: "처리 중",
  succeeded: "성공",
  success: "성공",
  partial: "부분 성공",
  error: "오류",
  used: "사용 완료",
  expired: "만료",
  revoked: "회수",
  reserved: "예약",
  repair: "수선",
  sale: "일반 주문",
  token: "토큰",
  safe: "안전",
  unsafe: "차단",
  approved: "승인",
  rejected: "거절",
  hold: "보류",
  duplicate: "중복 제외",
  invalid: "검증 제외",
  DONE: "완료",
  CANCELED: "취소",
  견적발송: "견적 발송",
  협의중: "협의 중",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = positive.has(status)
    ? "positive"
    : critical.has(status)
      ? "critical"
      : warning.has(status)
        ? "warning"
        : "informative";
  return <Badge tone={tone}>{statusLabels[status] ?? status}</Badge>;
}

export function ClaimStatusBadge({ claim }: { claim: ClaimBadgeOut }) {
  const presentation = claimBadge(claim);
  return <Badge tone={presentation.tone}>{presentation.label}</Badge>;
}

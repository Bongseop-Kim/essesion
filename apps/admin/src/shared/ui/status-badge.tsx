import type { ClaimBadgeOut } from "@essesion/api-client";
import { Badge } from "@essesion/shared";

const positive = new Set(["완료", "배송완료", "sent", "resolved", "active"]);
const critical = new Set(["실패", "거부", "취소", "failed", "inactive"]);
const warning = new Set(["대기중", "답변대기", "접수", "pending", "open"]);

export function StatusBadge({ status }: { status: string }) {
  const tone = positive.has(status)
    ? "positive"
    : critical.has(status)
      ? "critical"
      : warning.has(status)
        ? "warning"
        : "informative";
  return <Badge tone={tone}>{status}</Badge>;
}

export function claimBadge(claim: ClaimBadgeOut) {
  const typeLabel =
    claim.type === "cancel"
      ? "취소"
      : claim.type === "return"
        ? "반품"
        : claim.type === "exchange"
          ? "교환"
          : claim.type === "token_refund"
            ? "토큰 환불"
            : claim.type;
  if (claim.status === "거부") {
    return { label: `${typeLabel} 거부`, tone: "neutral" as const };
  }
  if (claim.type === "cancel") {
    return claim.status === "완료"
      ? { label: "취소 완료", tone: "critical" as const }
      : { label: "취소 처리중", tone: "warning" as const };
  }
  if (claim.type === "return" || claim.type === "exchange") {
    return claim.status === "완료"
      ? { label: `${typeLabel} 완료`, tone: "positive" as const }
      : { label: `${typeLabel} 진행중`, tone: "informative" as const };
  }
  if (claim.type === "token_refund") {
    return claim.status === "완료"
      ? { label: "토큰 환불 완료", tone: "positive" as const }
      : { label: "토큰 환불 처리중", tone: "warning" as const };
  }
  return { label: `${typeLabel} ${claim.status}`, tone: "neutral" as const };
}

export function ClaimStatusBadge({ claim }: { claim: ClaimBadgeOut }) {
  const presentation = claimBadge(claim);
  return <Badge tone={presentation.tone}>{presentation.label}</Badge>;
}

import type { ClaimBadgeOut } from "@essesion/api-client";
import { Badge, claimBadge } from "@essesion/shared";

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

export function ClaimStatusBadge({ claim }: { claim: ClaimBadgeOut }) {
  const presentation = claimBadge(claim);
  return <Badge tone={presentation.tone}>{presentation.label}</Badge>;
}

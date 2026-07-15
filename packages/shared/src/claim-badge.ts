export type ClaimBadgeInput = {
  type: string;
  status: string;
};

export type ClaimBadgePresentation = {
  label: string;
  tone: "neutral" | "positive" | "critical" | "warning" | "informative";
};

const TYPE_LABELS: Record<string, string> = {
  cancel: "취소",
  return: "반품",
  exchange: "교환",
  token_refund: "토큰 환불",
};

function fallbackTone(status: string): ClaimBadgePresentation["tone"] {
  if (status === "완료") return "positive";
  if (status === "접수") return "warning";
  if (["처리중", "수거요청", "수거완료", "재발송"].includes(status)) {
    return "informative";
  }
  return "neutral";
}

export function claimBadge(claim: ClaimBadgeInput): ClaimBadgePresentation {
  const typeLabel = TYPE_LABELS[claim.type] ?? claim.type;
  if (claim.status === "거부") {
    return { label: `${typeLabel} 거부`, tone: "neutral" };
  }
  if (claim.type === "cancel") {
    return claim.status === "완료"
      ? { label: "취소 완료", tone: "critical" }
      : { label: "취소 처리중", tone: "warning" };
  }
  if (claim.type === "return" || claim.type === "exchange") {
    return claim.status === "완료"
      ? { label: `${typeLabel} 완료`, tone: "positive" }
      : { label: `${typeLabel} 진행중`, tone: "informative" };
  }
  if (claim.type === "token_refund") {
    return claim.status === "완료"
      ? { label: "토큰 환불 완료", tone: "positive" }
      : { label: "토큰 환불 처리중", tone: "warning" };
  }
  return {
    label: `${typeLabel} ${claim.status}`,
    tone: fallbackTone(claim.status),
  };
}

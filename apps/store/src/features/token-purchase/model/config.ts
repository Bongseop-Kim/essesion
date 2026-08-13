import type { TokenPlan } from "@essesion/api-client";

export type TokenPurchaseDraft = { plan: TokenPlan };

export function tokenPlanLabel(planKey: string) {
  return (
    {
      starter: "스타터",
      popular: "인기",
      pro: "프로",
    }[planKey] ?? planKey
  );
}

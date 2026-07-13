import { createTokenOrderMutation } from "@essesion/api-client/query";
import { zTokenPlan } from "@essesion/api-client/zod";
import { Callout, Divider, Text, VStack } from "@essesion/shared";
import { useMutation } from "@tanstack/react-query";
import { Navigate, useLocation } from "react-router";

import {
  CHECKOUT_PENDING_KEY,
  CheckoutShell,
  useCheckoutPayment,
} from "@/features/checkout";
import {
  type TokenPurchaseDraft,
  tokenPlanLabel,
} from "@/features/token-purchase";
import { krw } from "@/pages/shop/constants";
import { useSession } from "@/shared/store/session";
import { SummaryCard } from "@/shared/ui/summary-card";

export function TokenPaymentPage() {
  const location = useLocation();
  const user = useSession((state) => state.user);
  const draft = readTokenPurchaseDraft(location.state);
  const createOrder = useMutation(createTokenOrderMutation());
  const payment = useCheckoutPayment({
    storageKey: CHECKOUT_PENDING_KEY,
    ownerUserId: user?.id ?? null,
    snapshot: draft
      ? {
          returnPath: "/token/purchase/payment",
          returnState: { tokenPurchase: draft },
          tokenPurchase: draft,
        }
      : null,
    orderName: `${tokenPlanLabel(draft?.plan.plan_key ?? "")} 토큰 플랜`,
    expectedAmount: draft?.plan.price,
    successPath: "/token/purchase/success",
    failPath: "/token/purchase/fail",
    createOrder: async () => {
      if (!draft) throw new Error("token plan is required");
      const planKey = draft.plan.plan_key;
      if (planKey !== "starter" && planKey !== "popular" && planKey !== "pro")
        throw new Error("지원하지 않는 토큰 플랜입니다.");
      const result = await createOrder.mutateAsync({
        body: { plan_key: planKey },
      });
      return {
        paymentGroupId: result.payment_group_id,
        totalAmount: result.price,
      };
    },
  });

  if (!draft) return <Navigate to="/token/purchase" replace />;

  return (
    <CheckoutShell
      breadcrumbs={[
        { label: "홈", href: "/" },
        { label: "토큰 충전", href: "/token/purchase" },
        { label: "토큰 결제" },
      ]}
      amount={draft.plan.price}
      customerKey={user?.id ?? null}
      summary={
        <SummaryCard.Root>
          <SummaryCard.Section
            title="결제 금액"
            description="선택한 토큰 플랜을 확인해 주세요."
          />
          <Divider />
          <SummaryCard.Row
            label="플랜"
            value={tokenPlanLabel(draft.plan.plan_key)}
          />
          <SummaryCard.Row
            label="충전 토큰"
            value={`${krw.format(draft.plan.token_amount)} 토큰`}
          />
          <SummaryCard.Total
            label="결제 예정 금액"
            value={`${krw.format(draft.plan.price)}원`}
          />
        </SummaryCard.Root>
      }
      payDisabled={!user}
      payLoading={payment.isPending}
      onPay={(widget) => void payment.pay(widget)}
    >
      <VStack gap="x6" alignItems="stretch">
        <VStack gap="x2">
          <Text as="h1" textStyle="title1">
            토큰 결제
          </Text>
          <Text textStyle="body" color="fg.neutral-muted">
            결제 완료 즉시 토큰이 충전됩니다.
          </Text>
        </VStack>
        <SummaryCard.Root>
          <SummaryCard.Section
            title={tokenPlanLabel(draft.plan.plan_key)}
            description={`${krw.format(draft.plan.token_amount)} 토큰`}
          />
          <SummaryCard.Row label="이용 기간" value="결제일로부터 1년" />
          <SummaryCard.Row
            label="결제 금액"
            value={`${krw.format(draft.plan.price)}원`}
          />
        </SummaryCard.Root>
        <Callout
          title="구매 전 확인"
          description="사용한 구매 토큰이 있으면 환불이 제한될 수 있습니다. 환불 가능 여부는 토큰 내역에서 확인할 수 있습니다."
        />
      </VStack>
    </CheckoutShell>
  );
}

function readTokenPurchaseDraft(state: unknown): TokenPurchaseDraft | null {
  if (!state || typeof state !== "object" || !("tokenPurchase" in state))
    return null;
  const raw = (state as { tokenPurchase?: unknown }).tokenPurchase;
  if (!raw || typeof raw !== "object" || !("plan" in raw)) return null;
  const parsed = zTokenPlan.safeParse((raw as { plan?: unknown }).plan);
  return parsed.success ? { plan: parsed.data } : null;
}

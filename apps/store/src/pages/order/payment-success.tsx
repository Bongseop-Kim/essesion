import type { RepairShippingIn } from "@essesion/api-client";
import {
  ActionButton,
  Box,
  ContentPlaceholder,
  ProgressCircle,
  ResultSection,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import { useRef } from "react";
import { useNavigate } from "react-router";
import { useCartActions } from "@/features/cart";
import {
  CHECKOUT_PENDING_KEY,
  clearPendingCheckout,
  onTerminalPaymentFailure,
  type PendingCheckout,
  readPendingCheckout,
  usePaymentConfirm,
  waitForSettledPaymentOwner,
} from "@/features/checkout";
import { clearCustomOrderFormDraft } from "@/features/custom-order";
import {
  isRepairShipmentDraft,
  planRepairOutcome,
  type RepairShipmentDraft,
  submitRepairShipment,
} from "@/features/repair-shipping";
import { trackEvent } from "@/shared/lib/analytics";
import { useSession } from "@/shared/store/session";
import { ResultEmoji } from "@/shared/ui/result-emoji";
import { ResultPageLayout } from "@/shared/ui/result-page-layout";

type CheckoutSnapshot = {
  cartItemIds?: string[];
  customOrder?: unknown;
  repairShipping?: RepairShippingIn | null;
  repairShipmentDraft?: unknown;
  returnPath?: string;
  returnState?: unknown;
};

type RepairResultView =
  | { kind: "pickup" }
  | { kind: "submitted" }
  | {
      kind: "register-cta";
      orderId: string;
      prefill: RepairShipmentDraft | null;
    }
  | null;

export function PaymentSuccessPage() {
  const navigate = useNavigate();
  const cartActions = useCartActions();
  const ownerUserId = useSession((state) => state.user?.id ?? null);
  const confirmationContext = useRef<{
    ownerUserId: string | null;
    value: PendingCheckout<CheckoutSnapshot> | null;
  }>({
    ownerUserId,
    value: readPendingCheckout<CheckoutSnapshot>(
      CHECKOUT_PENDING_KEY,
      ownerUserId,
    ),
  });
  const {
    valid,
    confirmed,
    failed,
    data: repairResult,
    isPending,
    retry,
  } = usePaymentConfirm<RepairResultView>(
    async (result, paymentGroupId) => {
      const context = confirmationContext.current;
      const pending =
        context.value?.paymentGroupId === paymentGroupId ? context.value : null;
      // 새로고침 재confirm 시에도 발화되지만 transaction_id로 GA가 dedup한다.
      // paymentKey·orderId 원문은 넣지 않는다.
      trackEvent("purchase", {
        currency: "KRW",
        value:
          pending?.totalAmount ??
          // usePaymentConfirm이 amount 정수·양수 검증을 통과한 뒤에만 여기 도달한다
          Number(
            new URLSearchParams(window.location.search).get("amount") ?? 0,
          ),
        transaction_id: result.orders[0]?.order_number,
      });
      const initialOwnerState = await waitForSettledPaymentOwner(
        context.ownerUserId,
      );
      if (initialOwnerState === "different") {
        if (pending) {
          if (pending.snapshot.customOrder && context.ownerUserId) {
            clearCustomOrderFormDraft(context.ownerUserId);
          }
          clearPendingCheckout(CHECKOUT_PENDING_KEY, context.ownerUserId);
        }
        return null;
      }
      const draft = isRepairShipmentDraft(pending?.snapshot.repairShipmentDraft)
        ? pending.snapshot.repairShipmentDraft
        : null;
      const plan = planRepairOutcome(result.orders, draft);
      let view: RepairResultView = null;
      if (plan.kind === "auto-submit") {
        // 개선 A: 체크아웃에서 입력한 발송 정보를 자동 등록 — 실패해도 결제 완료 처리는 계속
        try {
          await submitRepairShipment(plan.orderId, plan.draft);
          view = { kind: "submitted" };
        } catch {
          view = {
            kind: "register-cta",
            orderId: plan.orderId,
            prefill: plan.draft,
          };
        }
      } else if (plan.kind === "pickup" || plan.kind === "submitted") {
        view = { kind: plan.kind };
      } else if (plan.kind === "register-cta") {
        view = { kind: "register-cta", orderId: plan.orderId, prefill: null };
      }
      const nextOwnerState = await waitForSettledPaymentOwner(
        context.ownerUserId,
      );
      if (nextOwnerState === "different") {
        if (pending) {
          if (pending.snapshot.customOrder && context.ownerUserId) {
            clearCustomOrderFormDraft(context.ownerUserId);
          }
          clearPendingCheckout(CHECKOUT_PENDING_KEY, context.ownerUserId);
        }
        return view;
      }
      const ids = pending?.snapshot.cartItemIds?.filter(
        (id): id is string => typeof id === "string",
      );
      if (pending?.snapshot.customOrder) {
        if (context.ownerUserId) clearCustomOrderFormDraft(context.ownerUserId);
      }
      if (ids?.length) {
        try {
          await cartActions.removeItems(ids);
        } catch {
          snackbar("결제는 완료됐지만 장바구니를 정리하지 못했습니다.");
        }
      }
      // 정리 실패와 무관하게 결제 완료된 pending은 제거 — 남으면 이미 결제된
      // paymentGroupId가 다음 결제에서 재사용된다.
      if (pending) {
        clearPendingCheckout(CHECKOUT_PENDING_KEY, context.ownerUserId);
      }
      return view;
    },
    {
      onTerminalFailure: onTerminalPaymentFailure(() => ({
        ownerUserId: confirmationContext.current.ownerUserId,
        paymentGroupId: confirmationContext.current.value?.paymentGroupId,
      })),
    },
  );

  if (!valid) {
    return (
      <ResultPageLayout>
        <ContentPlaceholder
          title="결제 정보를 확인할 수 없습니다"
          description="장바구니에서 주문을 다시 진행해 주세요."
          action={
            <ActionButton type="button" onClick={() => navigate("/cart")}>
              장바구니로 이동
            </ActionButton>
          }
        />
      </ResultPageLayout>
    );
  }

  if (!confirmed && !failed) {
    return (
      <ResultPageLayout>
        <VStack gap="x3" align="center" py="x12">
          <ProgressCircle />
          <Text textStyle="body">결제 확인 중입니다</Text>
        </VStack>
      </ResultPageLayout>
    );
  }

  if (failed) {
    return (
      <ResultPageLayout>
        <ContentPlaceholder
          title="결제를 확인하지 못했습니다"
          description="다시 확인해도 결제는 중복 처리되지 않습니다."
          action={
            <VStack gap="x2">
              <ActionButton
                type="button"
                loading={isPending}
                onClick={() => void retry()}
              >
                다시 확인
              </ActionButton>
              <ActionButton
                type="button"
                variant="ghost"
                onClick={() =>
                  returnToOrder(
                    navigate,
                    confirmationContext.current.ownerUserId === ownerUserId
                      ? confirmationContext.current.value
                      : null,
                  )
                }
              >
                주문서로 돌아가기
              </ActionButton>
            </VStack>
          }
        />
      </ResultPageLayout>
    );
  }

  return (
    <ResultPageLayout>
      <VStack gap="x6" alignItems="stretch">
        <ResultSection
          asset={<ResultEmoji emoji="🎉" />}
          title={
            repairResult?.kind === "pickup"
              ? "방문 수거 신청이 완료되었습니다"
              : repairResult
                ? "수선 접수가 완료되었습니다"
                : "결제가 완료되었습니다"
          }
          description={
            repairResult?.kind === "pickup"
              ? "기사님이 입력한 수거지에 방문할 예정입니다."
              : repairResult?.kind === "submitted"
                ? "발송 정보까지 등록되었습니다. 진행 상황은 주문 내역에서 확인할 수 있습니다."
                : repairResult?.kind === "register-cta"
                  ? "수선품을 발송한 뒤 발송 확인을 해주세요."
                  : "주문이 정상적으로 접수되었습니다."
          }
        />
        <VStack gap="x2" align="center">
          {repairResult?.kind === "register-cta" ? (
            <>
              <Box
                as={ActionButton}
                type="button"
                size="large"
                width={{ base: "full", md: 320 }}
                onClick={() =>
                  navigate(`/order/${repairResult.orderId}/repair-shipping`, {
                    state: { prefill: repairResult.prefill },
                  })
                }
              >
                발송 확인하기
              </Box>
              <ActionButton
                type="button"
                variant="ghost"
                onClick={() => navigate("/shop")}
              >
                쇼핑 계속하기
              </ActionButton>
            </>
          ) : (
            <>
              <Box
                as={ActionButton}
                type="button"
                size="large"
                width={{ base: "full", md: 320 }}
                onClick={() => navigate("/shop")}
              >
                쇼핑 계속하기
              </Box>
              {repairResult?.kind === "submitted" ? (
                <ActionButton
                  type="button"
                  variant="ghost"
                  onClick={() => navigate("/my-page/orders")}
                >
                  주문 내역 보기
                </ActionButton>
              ) : (
                <ActionButton
                  type="button"
                  variant="ghost"
                  onClick={() => navigate("/")}
                >
                  홈으로 이동
                </ActionButton>
              )}
            </>
          )}
        </VStack>
      </VStack>
    </ResultPageLayout>
  );
}

function returnToOrder(
  navigate: ReturnType<typeof useNavigate>,
  pending: PendingCheckout<CheckoutSnapshot> | null,
) {
  const cartItemIds = pending?.snapshot.cartItemIds;
  navigate(pending?.snapshot.returnPath ?? "/order/order-form", {
    state: pending?.snapshot.returnState ?? { cartItemIds },
  });
}

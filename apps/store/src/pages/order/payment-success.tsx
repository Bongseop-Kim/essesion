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
import { useNavigate } from "react-router";
import { useCartActions } from "@/features/cart";
import {
  CHECKOUT_PENDING_KEY,
  clearPendingCheckout,
  readPendingCheckout,
  usePaymentConfirm,
} from "@/features/checkout";
import { CUSTOM_ORDER_DRAFT_KEY } from "@/features/custom-order";
import {
  isRepairShipmentDraft,
  planRepairOutcome,
  type RepairShipmentDraft,
  submitRepairShipment,
} from "@/features/repair-shipping";
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
  const {
    valid,
    confirmed,
    failed,
    data: repairResult,
    isPending,
    retry,
  } = usePaymentConfirm<RepairResultView>(async (result) => {
    const pending = readPendingCheckout<CheckoutSnapshot>(CHECKOUT_PENDING_KEY);
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
    const ids = pending?.snapshot.cartItemIds?.filter(
      (id): id is string => typeof id === "string",
    );
    if (pending?.snapshot.customOrder) {
      sessionStorage.removeItem(CUSTOM_ORDER_DRAFT_KEY);
    }
    if (ids?.length) {
      try {
        await cartActions.removeItems(ids);
        clearPendingCheckout(CHECKOUT_PENDING_KEY);
      } catch {
        snackbar("결제는 완료됐지만 장바구니를 정리하지 못했습니다.");
      }
    } else {
      clearPendingCheckout(CHECKOUT_PENDING_KEY);
    }
    return view;
  });

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
                onClick={() => returnToOrder(navigate)}
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

function returnToOrder(navigate: ReturnType<typeof useNavigate>) {
  const pending = readPendingCheckout<CheckoutSnapshot>(CHECKOUT_PENDING_KEY);
  const cartItemIds = pending?.snapshot.cartItemIds;
  navigate(pending?.snapshot.returnPath ?? "/order/order-form", {
    state: pending?.snapshot.returnState ?? { cartItemIds },
  });
}

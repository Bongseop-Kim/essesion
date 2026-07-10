import type { RepairShippingIn } from "@essesion/api-client";
import { confirmPaymentMutation } from "@essesion/api-client/query";
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
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useCartActions } from "@/features/cart";
import {
  CHECKOUT_PENDING_KEY,
  clearPendingCheckout,
  readPendingCheckout,
} from "@/features/checkout";
import { ResultEmoji } from "@/shared/ui/result-emoji";
import { ResultPageLayout } from "@/shared/ui/result-page-layout";

type CheckoutSnapshot = {
  cartItemIds?: string[];
  repairShipping?: RepairShippingIn | null;
};

export function PaymentSuccessPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const paymentKey = params.get("paymentKey");
  const orderId = params.get("orderId");
  const amount = Number(params.get("amount"));
  const valid =
    !!paymentKey && !!orderId && Number.isInteger(amount) && amount > 0;
  const confirm = useMutation(confirmPaymentMutation());
  const cartActions = useCartActions();
  const [confirmed, setConfirmed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirmedRepairMethod, setConfirmedRepairMethod] = useState<
    "direct" | "pickup" | null
  >(null);
  const started = useRef(false);

  const confirmNow = useCallback(async () => {
    if (!valid || !paymentKey || !orderId) return;
    setFailed(false);
    try {
      const result = await confirm.mutateAsync({
        body: {
          payment_key: paymentKey,
          payment_group_id: orderId,
          amount,
        },
      });
      const pending =
        readPendingCheckout<CheckoutSnapshot>(CHECKOUT_PENDING_KEY);
      if (result.orders.some((order) => order.order_type === "repair")) {
        setConfirmedRepairMethod(
          pending?.snapshot.repairShipping?.method ?? "direct",
        );
      }
      const ids = pending?.snapshot.cartItemIds?.filter(
        (id): id is string => typeof id === "string",
      );
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
      setConfirmed(true);
    } catch {
      setFailed(true);
    }
  }, [amount, cartActions, confirm, orderId, paymentKey, valid]);

  useEffect(() => {
    if (started.current || !valid) return;
    started.current = true;
    void confirmNow();
  }, [confirmNow, valid]);

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
                loading={confirm.isPending}
                onClick={() => void confirmNow()}
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
            confirmedRepairMethod === "pickup"
              ? "방문 수거 신청이 완료되었습니다"
              : confirmedRepairMethod === "direct"
                ? "수선 접수가 완료되었습니다"
                : "결제가 완료되었습니다"
          }
          description={
            confirmedRepairMethod === "pickup"
              ? "기사님이 입력한 수거지에 방문할 예정입니다."
              : confirmedRepairMethod === "direct"
                ? "수선품을 직접 발송한 뒤 송장 정보를 등록해 주세요."
                : "주문이 정상적으로 접수되었습니다."
          }
        />
        <VStack gap="x2" align="center">
          <Box
            as={ActionButton}
            type="button"
            size="large"
            width={{ base: "full", md: 320 }}
            onClick={() => navigate("/shop")}
          >
            쇼핑 계속하기
          </Box>
          <ActionButton
            type="button"
            variant="ghost"
            onClick={() => navigate("/")}
          >
            홈으로 이동
          </ActionButton>
        </VStack>
      </VStack>
    </ResultPageLayout>
  );
}

function returnToOrder(navigate: ReturnType<typeof useNavigate>) {
  const pending = readPendingCheckout<CheckoutSnapshot>(CHECKOUT_PENDING_KEY);
  const cartItemIds = pending?.snapshot.cartItemIds;
  navigate("/order/order-form", { state: { cartItemIds } });
}

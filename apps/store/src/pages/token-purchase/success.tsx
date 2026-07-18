import { getTokenBalanceQueryKey } from "@essesion/api-client/query";
import {
  ActionButton,
  Box,
  ContentPlaceholder,
  ProgressCircle,
  ResultSection,
  Text,
  VStack,
} from "@essesion/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useNavigate } from "react-router";

import {
  CHECKOUT_PENDING_KEY,
  clearPendingCheckout,
  readPendingCheckout,
  usePaymentConfirm,
  waitForSettledPaymentOwner,
} from "@/features/checkout";
import { krw } from "@/pages/shop/constants";
import { trackEvent } from "@/shared/lib/analytics";
import { useSession } from "@/shared/store/session";
import { ResultEmoji } from "@/shared/ui/result-emoji";
import { ResultPageLayout } from "@/shared/ui/result-page-layout";

export function TokenPurchaseSuccessPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const ownerUserId = useSession((state) => state.user?.id ?? null);
  const confirmationContext = useRef({
    ownerUserId,
    pending: readPendingCheckout(CHECKOUT_PENDING_KEY, ownerUserId),
  });
  const {
    valid,
    confirmed,
    failed,
    data: tokenAmount,
    isPending,
    retry,
  } = usePaymentConfirm<number>(
    async (result, paymentGroupId) => {
      const context = confirmationContext.current;
      const pending =
        context.pending?.paymentGroupId === paymentGroupId
          ? context.pending
          : null;
      // 새로고침 재confirm 시에도 발화되지만 GA 세션 내 동일 파라미터로 사실상 dedup된다
      trackEvent("token_purchase", {
        currency: "KRW",
        value:
          pending?.totalAmount ??
          Number(
            new URLSearchParams(window.location.search).get("amount") ?? 0,
          ),
        token_amount: result.token_amount ?? 0,
      });
      const ownerState = await waitForSettledPaymentOwner(context.ownerUserId);
      if (pending) {
        clearPendingCheckout(CHECKOUT_PENDING_KEY, context.ownerUserId);
      }
      if (ownerState !== "current") return 0;
      await queryClient.invalidateQueries({
        queryKey: getTokenBalanceQueryKey(),
      });
      return result.token_amount ?? 0;
    },
    {
      onTerminalFailure: (_error, paymentGroupId) => {
        const context = confirmationContext.current;
        void waitForSettledPaymentOwner(context.ownerUserId).then(
          (ownerState) => {
            if (
              ownerState === "current" &&
              context.pending?.paymentGroupId === paymentGroupId
            ) {
              clearPendingCheckout(CHECKOUT_PENDING_KEY, context.ownerUserId);
            }
          },
        );
      },
    },
  );

  if (!valid) {
    return (
      <ResultPageLayout>
        <ContentPlaceholder
          title="결제 정보를 확인할 수 없습니다"
          description="토큰 구매에서 결제를 다시 진행해 주세요."
          action={
            <ActionButton onClick={() => navigate("/token/purchase")}>
              토큰 구매로 이동
            </ActionButton>
          }
        />
      </ResultPageLayout>
    );
  }

  if (failed) {
    return (
      <ResultPageLayout>
        <ContentPlaceholder
          title="토큰 결제를 확인하지 못했습니다"
          description="다시 확인해도 결제와 충전은 중복 처리되지 않습니다."
          action={
            <ActionButton loading={isPending} onClick={() => void retry()}>
              다시 확인
            </ActionButton>
          }
        />
      </ResultPageLayout>
    );
  }

  if (!confirmed) {
    return (
      <ResultPageLayout>
        <VStack gap="x3" align="center">
          <ProgressCircle />
          <Text textStyle="body">결제와 토큰 충전을 확인하고 있습니다</Text>
        </VStack>
      </ResultPageLayout>
    );
  }

  return (
    <ResultPageLayout>
      <VStack gap="x6" alignItems="stretch">
        <ResultSection
          asset={<ResultEmoji emoji="🪙" />}
          title={`${krw.format(tokenAmount ?? 0)} 토큰이 충전되었습니다`}
          description="현재 잔액과 사용 내역은 마이페이지에서 확인할 수 있습니다."
        />
        <VStack gap="x2" align="center">
          <Box
            as={ActionButton}
            width={{ base: "full", md: 320 }}
            size="large"
            onClick={() => navigate("/design")}
          >
            디자인 시작하기
          </Box>
          <ActionButton
            variant="ghost"
            onClick={() => navigate("/my-page/token-history")}
          >
            토큰 내역 보기
          </ActionButton>
        </VStack>
      </VStack>
    </ResultPageLayout>
  );
}

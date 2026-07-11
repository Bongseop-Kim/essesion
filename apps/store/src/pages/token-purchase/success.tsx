import {
  confirmPaymentMutation,
  getTokenBalanceQueryKey,
} from "@essesion/api-client/query";
import {
  ActionButton,
  Box,
  ContentPlaceholder,
  ProgressCircle,
  ResultSection,
  Text,
  VStack,
} from "@essesion/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import {
  CHECKOUT_PENDING_KEY,
  clearPendingCheckout,
} from "@/features/checkout";
import { krw } from "@/pages/shop/constants";
import { ResultEmoji } from "@/shared/ui/result-emoji";
import { ResultPageLayout } from "@/shared/ui/result-page-layout";

export function TokenPurchaseSuccessPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const paymentKey = params.get("paymentKey");
  const orderId = params.get("orderId");
  const amount = Number(params.get("amount"));
  const valid =
    !!paymentKey && !!orderId && Number.isInteger(amount) && amount > 0;
  const confirm = useMutation(confirmPaymentMutation());
  const [tokenAmount, setTokenAmount] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
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
      setTokenAmount(result.token_amount ?? 0);
      clearPendingCheckout(CHECKOUT_PENDING_KEY);
      await queryClient.invalidateQueries({
        queryKey: getTokenBalanceQueryKey(),
      });
    } catch {
      setFailed(true);
    }
  }, [amount, confirm, orderId, paymentKey, queryClient, valid]);

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
            <ActionButton
              loading={confirm.isPending}
              onClick={() => void confirmNow()}
            >
              다시 확인
            </ActionButton>
          }
        />
      </ResultPageLayout>
    );
  }

  if (tokenAmount == null) {
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
          title={`${krw.format(tokenAmount)} 토큰이 충전되었습니다`}
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

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
import { useNavigate } from "react-router";

import {
  CHECKOUT_PENDING_KEY,
  clearPendingCheckout,
  usePaymentConfirm,
} from "@/features/checkout";
import { krw } from "@/pages/shop/constants";
import { ResultEmoji } from "@/shared/ui/result-emoji";
import { ResultPageLayout } from "@/shared/ui/result-page-layout";

export function TokenPurchaseSuccessPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    valid,
    confirmed,
    failed,
    data: tokenAmount,
    isPending,
    retry,
  } = usePaymentConfirm<number>(async (result) => {
    clearPendingCheckout(CHECKOUT_PENDING_KEY);
    await queryClient.invalidateQueries({
      queryKey: getTokenBalanceQueryKey(),
    });
    return result.token_amount ?? 0;
  });

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

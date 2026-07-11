import type { RefundableTokenOrder } from "@essesion/api-client";
import {
  getOrderQueryKey,
  listMyClaimsQueryKey,
  listMyOrdersQueryKey,
  listRefundableTokenOrdersOptions,
  listRefundableTokenOrdersQueryKey,
  requestTokenRefundMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Box,
  Callout,
  Skeleton,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";

import { krw } from "@/pages/shop/constants";

/**
 * 토큰 주문 상세의 환불 섹션 — 자격 판정은 서버 `RefundableTokenOrder`를
 * 그대로 신뢰하고(reason·is_refundable), 프론트는 렌더 분기만 한다.
 * 신청 취소는 클레임 상세(신청 취소 버튼)로 통일한다.
 */
export function TokenRefundSection({ orderId }: { orderId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const refundableQuery = useQuery(listRefundableTokenOrdersOptions());
  const requestRefund = useMutation({
    ...requestTokenRefundMutation(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: listRefundableTokenOrdersQueryKey(),
        }),
        queryClient.invalidateQueries({ queryKey: listMyClaimsQueryKey() }),
        queryClient.invalidateQueries({
          queryKey: getOrderQueryKey({ path: { order_id: orderId } }),
        }),
        queryClient.invalidateQueries({ queryKey: listMyOrdersQueryKey() }),
      ]);
      setConfirmOpen(false);
      snackbar("토큰 환불 신청을 접수했습니다.");
    },
    onError: () => snackbar("환불을 신청하지 못했습니다. 다시 시도해 주세요."),
  });

  if (refundableQuery.isPending) {
    return <Skeleton width="100%" height={96} />;
  }
  if (refundableQuery.isError) {
    return (
      <Callout
        tone="neutral"
        title="환불 가능 여부를 확인하지 못했습니다"
        description="다시 시도해 주세요."
        onClick={() => void refundableQuery.refetch()}
      />
    );
  }

  const entry = refundableQuery.data.find((row) => row.order_id === orderId);
  if (!entry) return null;

  if (entry.reason === "pending_refund") {
    return (
      <Callout
        tone="informative"
        title="토큰 환불 신청이 접수되었습니다"
        description="관리자 확인 후 결제가 취소됩니다. 신청 취소는 클레임 상세에서 할 수 있습니다."
        onClick={() => navigate("/my-page/claims")}
      />
    );
  }
  if (entry.reason === "approved_refund") {
    return (
      <Callout
        tone="positive"
        title="토큰 환불이 완료되었습니다"
        description="결제가 취소되어 지급된 토큰이 회수되었습니다."
      />
    );
  }
  if (!entry.is_refundable) {
    return (
      <Callout
        tone="neutral"
        title="환불할 수 없는 주문입니다"
        description={ineligibleDescription(entry)}
      />
    );
  }

  return (
    <Box bg="bg.neutral-weak" borderRadius="r3" p="x4">
      <VStack gap="x3" alignItems="stretch">
        <VStack gap="x1">
          <Text as="h2" textStyle="title3">
            토큰 환불
          </Text>
          <Text textStyle="bodySm" color="fg.neutral-muted">
            최근 구매한 토큰을 사용하지 않은 경우에만 환불할 수 있습니다. 신청
            시 지급된 토큰 {krw.format(entry.paid_tokens_granted)}개가 회수되고{" "}
            {krw.format(entry.total_price)}원이 환불됩니다.
          </Text>
        </VStack>
        <ActionButton
          type="button"
          variant="neutralWeak"
          onClick={() => setConfirmOpen(true)}
        >
          환불 신청
        </ActionButton>
      </VStack>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="토큰 환불을 신청할까요?"
        description={`지급된 토큰 ${krw.format(entry.paid_tokens_granted)}개가 회수되며, 관리자 확인 후 ${krw.format(entry.total_price)}원이 환불됩니다.`}
        primaryActionProps={{
          children: "환불 신청",
          loading: requestRefund.isPending,
          onClick: () => requestRefund.mutate({ body: { order_id: orderId } }),
        }}
        secondaryActionProps={{ children: "돌아가기" }}
      />
    </Box>
  );
}

function ineligibleDescription(entry: RefundableTokenOrder): string {
  switch (entry.reason) {
    case "tokens_used":
      return "구매 후 토큰을 사용해 환불할 수 없습니다.";
    case "not_latest":
      return "가장 최근에 구매한 토큰 주문만 환불할 수 있습니다.";
    case "expired":
      return "토큰 유효기간이 만료되어 환불할 수 없습니다.";
    default:
      return "환불 가능한 유료 토큰이 없습니다.";
  }
}

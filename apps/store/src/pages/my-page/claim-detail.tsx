import {
  cancelClaimMutation,
  cancelTokenRefundMutation,
  getOrderQueryKey,
  listMyClaimsOptions,
  listMyClaimsQueryKey,
  listMyOrdersQueryKey,
  listRefundableTokenOrdersQueryKey,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Badge,
  Box,
  ContentPlaceholder,
  Divider,
  HStack,
  List,
  ListItem,
  Skeleton,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";

import {
  claimItemTitle,
  claimReasonLabel,
  claimStatusTone,
  claimTypeLabel,
} from "@/features/claims";
import { courierLabel, courierTrackingUrl } from "@/features/repair-shipping";
import { krw } from "@/pages/shop/constants";
import { formatDate } from "@/shared/lib/format";
import { ContentLayout } from "@/shared/ui/content-layout";
import { InfoRow } from "@/shared/ui/info-row";

export function ClaimDetailPage() {
  const { claimId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const claimsQuery = useQuery(listMyClaimsOptions());
  const claim = claimsQuery.data?.find((entry) => entry.id === claimId);
  const afterCancel = async (message: string) => {
    if (!claim) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: listMyClaimsQueryKey() }),
      queryClient.invalidateQueries({
        queryKey: getOrderQueryKey({ path: { order_id: claim.order_id } }),
      }),
      queryClient.invalidateQueries({ queryKey: listMyOrdersQueryKey() }),
      queryClient.invalidateQueries({
        queryKey: listRefundableTokenOrdersQueryKey(),
      }),
    ]);
    snackbar(message);
    navigate("/my-page/claims", { replace: true });
  };
  const cancelClaim = useMutation({
    ...cancelClaimMutation(),
    onSuccess: () => afterCancel("클레임 신청을 취소했습니다."),
    onError: () => snackbar("신청을 취소하지 못했습니다. 다시 시도해 주세요."),
  });
  const cancelTokenRefund = useMutation({
    ...cancelTokenRefundMutation(),
    onSuccess: () => afterCancel("토큰 환불 신청을 취소했습니다."),
    onError: () => snackbar("신청을 취소하지 못했습니다. 다시 시도해 주세요."),
  });

  if (!claimId) return <Navigate to="/my-page/claims" replace />;

  const sidebar = claim ? (
    <Box
      bg="bg.layer-default"
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="r3"
      p="x5"
    >
      <VStack gap="x4" alignItems="stretch">
        <HStack justify="space-between" gap="x3">
          <Text as="h2" textStyle="title3">
            신청 요약
          </Text>
          <Badge tone={claimStatusTone(claim.status)}>{claim.status}</Badge>
        </HStack>
        <InfoRow label="유형" value={claimTypeLabel(claim.type)} />
        <InfoRow label="사유" value={claimReasonLabel(claim.reason)} />
        <InfoRow label="접수일" value={formatDate(claim.created_at)} />
        <InfoRow label="클레임 번호" value={claim.claim_number} />
        <InfoRow label="주문 번호" value={claim.order_number} />
      </VStack>
    </Box>
  ) : claimsQuery.isPending ? (
    <Skeleton width="100%" height={280} />
  ) : undefined;

  return (
    <ContentLayout
      breadcrumbs={[
        { label: "홈", href: "/" },
        { label: "클레임 내역", href: "/my-page/claims" },
        { label: "클레임 상세" },
      ]}
      sidebar={sidebar}
    >
      {claimsQuery.isPending ? (
        <VStack gap="x4" alignItems="stretch">
          <Skeleton width="45%" height={32} />
          <Skeleton width="100%" height={96} />
          <Skeleton width="100%" height={160} />
        </VStack>
      ) : claimsQuery.isError ? (
        <ContentPlaceholder
          title="클레임을 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
          action={
            <ActionButton
              type="button"
              variant="neutralOutline"
              onClick={() => void claimsQuery.refetch()}
            >
              다시 시도
            </ActionButton>
          }
        />
      ) : !claim ? (
        <ContentPlaceholder
          title="클레임 내역을 찾을 수 없습니다"
          description="취소되었거나 존재하지 않는 신청입니다."
          action={
            <ActionButton
              type="button"
              variant="neutralOutline"
              onClick={() => navigate("/my-page/claims")}
            >
              목록으로 이동
            </ActionButton>
          }
        />
      ) : (
        <VStack gap="x6" alignItems="stretch">
          <VStack gap="x2">
            <HStack gap="x3">
              <Text as="h1" textStyle="title1">
                {claimTypeLabel(claim.type)} 상세
              </Text>
              <Badge tone={claimStatusTone(claim.status)}>{claim.status}</Badge>
            </HStack>
            <Text textStyle="caption" color="fg.neutral-muted">
              {claim.claim_number}
            </Text>
          </VStack>

          <VStack gap="x3" alignItems="stretch">
            <Text as="h2" textStyle="title3">
              대상 상품
            </Text>
            <List>
              <ListItem
                title={claimItemTitle(claim.item)}
                description={`${claim.quantity}개 · 주문 ${claim.order_number}`}
              />
            </List>
          </VStack>

          <VStack gap="x3" alignItems="stretch">
            <Text as="h2" textStyle="title3">
              신청 내용
            </Text>
            <InfoRow label="사유" value={claimReasonLabel(claim.reason)} />
            <Divider />
            <Text textStyle="body" color="fg.neutral-muted">
              {claim.description || "상세 내용이 없습니다."}
            </Text>
          </VStack>

          <ClaimTracking
            title="반품 수거 정보"
            courier={claim.return_courier_company}
            trackingNumber={claim.return_tracking_number}
          />
          <ClaimTracking
            title="교환 재발송 정보"
            courier={claim.resend_courier_company}
            trackingNumber={claim.resend_tracking_number}
          />

          {claim.refund_data ? (
            <VStack gap="x3" alignItems="stretch">
              <Text as="h2" textStyle="title3">
                환불 정보
              </Text>
              {Object.entries(claim.refund_data).map(([key, value]) => (
                <InfoRow
                  key={key}
                  label={REFUND_DATA_LABELS[key] ?? key}
                  value={displayRefundValue(key, value)}
                />
              ))}
            </VStack>
          ) : null}

          {claim.status === "접수" ? (
            <ActionButton
              type="button"
              variant="criticalSolid"
              onClick={() => setConfirmOpen(true)}
            >
              신청 취소
            </ActionButton>
          ) : null}

          {claim.type === "token_refund" ? (
            <AlertDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              title="토큰 환불 신청을 취소할까요?"
              description="환불 신청이 취소 처리되며 지급된 토큰은 그대로 유지됩니다."
              primaryActionProps={{
                children: "신청 취소",
                variant: "criticalSolid",
                loading: cancelTokenRefund.isPending,
                onClick: () =>
                  cancelTokenRefund.mutate({ path: { claim_id: claim.id } }),
              }}
              secondaryActionProps={{ children: "유지" }}
            />
          ) : (
            <AlertDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              title="클레임 신청을 취소할까요?"
              description="접수한 신청이 삭제되며 주문 상세에서 다시 신청할 수 있습니다."
              primaryActionProps={{
                children: "신청 취소",
                variant: "criticalSolid",
                loading: cancelClaim.isPending,
                onClick: () =>
                  cancelClaim.mutate({ path: { claim_id: claim.id } }),
              }}
              secondaryActionProps={{ children: "유지" }}
            />
          )}
        </VStack>
      )}
    </ContentLayout>
  );
}

function ClaimTracking({
  title,
  courier,
  trackingNumber,
}: {
  title: string;
  courier: string | null;
  trackingNumber: string | null;
}) {
  if (!courier && !trackingNumber) return null;
  const url = courierTrackingUrl(courier, trackingNumber);
  return (
    <VStack gap="x3" alignItems="stretch">
      <Text as="h2" textStyle="title3">
        {title}
      </Text>
      <Text textStyle="body">
        {courierLabel(courier)} · {trackingNumber ?? "-"}
      </Text>
      {url ? (
        <ActionButton
          type="button"
          variant="neutralOutline"
          onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
        >
          배송조회
        </ActionButton>
      ) : null}
    </VStack>
  );
}

const REFUND_DATA_LABELS: Record<string, string> = {
  paid_token_amount: "환불 토큰",
  bonus_token_amount: "보너스 토큰",
  refund_amount: "환불 금액",
};

function displayRefundValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") {
    if (key === "refund_amount") return `${krw.format(value)}원`;
    if (key.endsWith("_token_amount")) return `${krw.format(value)}개`;
    return krw.format(value);
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

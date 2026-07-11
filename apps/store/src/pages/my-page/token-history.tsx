import type {
  RefundableTokenOrder,
  TokenHistoryEntry,
} from "@essesion/api-client";
import {
  cancelTokenRefundMutation,
  getTokenBalanceOptions,
  getTokenBalanceQueryKey,
  listMyClaimsQueryKey,
  listRefundableTokenOrdersOptions,
  listRefundableTokenOrdersQueryKey,
  listTokenHistoryInfiniteOptions,
  listTokenHistoryQueryKey,
  requestTokenRefundMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Badge,
  Box,
  Callout,
  Chip,
  ContentPlaceholder,
  HStack,
  List,
  ListHeader,
  ListItem,
  ProgressCircle,
  ScrollFog,
  Skeleton,
  snackbar,
  Text,
  useBreakpoint,
  VStack,
} from "@essesion/shared";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { krw } from "@/pages/shop/constants";
import { groupByCreatedDate } from "@/shared/lib/date-groups";
import { ContentLayout } from "@/shared/ui/content-layout";
import { SummaryCard } from "@/shared/ui/summary-card";

type HistoryFilter = "all" | "credit" | "use" | "refund";

const HISTORY_PAGE_SIZE = 50;
const HISTORY_PAGE_REQUEST_SIZE = HISTORY_PAGE_SIZE + 1;
const HISTORY_FILTERS: readonly { value: HistoryFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "credit", label: "구매·지급" },
  { value: "use", label: "사용" },
  { value: "refund", label: "환불" },
];

export function TokenHistoryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === "base" || breakpoint === "sm";
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [refundTarget, setRefundTarget] = useState<RefundableTokenOrder | null>(
    null,
  );
  const [cancelTarget, setCancelTarget] = useState<RefundableTokenOrder | null>(
    null,
  );

  const balanceQuery = useQuery(getTokenBalanceOptions());
  const refundableQuery = useQuery(listRefundableTokenOrdersOptions());
  const historyOptions = useMemo(
    () => ({
      query: {
        limit: HISTORY_PAGE_REQUEST_SIZE,
        type: historyFilter === "all" ? undefined : historyFilter,
      },
    }),
    [historyFilter],
  );
  const historyQuery = useInfiniteQuery({
    ...listTokenHistoryInfiniteOptions(historyOptions),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length > HISTORY_PAGE_SIZE
        ? allPages.length * HISTORY_PAGE_SIZE
        : undefined,
  });
  const history =
    historyQuery.data?.pages.flatMap((page) =>
      page.slice(0, HISTORY_PAGE_SIZE),
    ) ?? [];
  const historyGroups = groupByCreatedDate(history);

  const invalidateTokenData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getTokenBalanceQueryKey() }),
      queryClient.invalidateQueries({
        queryKey: listRefundableTokenOrdersQueryKey(),
      }),
      queryClient.invalidateQueries({ queryKey: listMyClaimsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: listTokenHistoryQueryKey() }),
    ]);
  };
  const requestRefund = useMutation({
    ...requestTokenRefundMutation(),
    onSuccess: async () => {
      await invalidateTokenData();
      setRefundTarget(null);
      snackbar("토큰 환불 신청을 접수했습니다.");
    },
    onError: () => snackbar("환불을 신청하지 못했습니다. 다시 시도해 주세요."),
  });
  const cancelRefund = useMutation({
    ...cancelTokenRefundMutation(),
    onSuccess: async () => {
      await invalidateTokenData();
      setCancelTarget(null);
      snackbar("토큰 환불 신청을 취소했습니다.");
    },
    onError: () =>
      snackbar("환불 신청을 취소하지 못했습니다. 다시 시도해 주세요."),
  });

  useEffect(() => {
    if (
      !isMobile ||
      !historyQuery.hasNextPage ||
      historyQuery.isFetchingNextPage ||
      historyQuery.isFetchNextPageError
    ) {
      return;
    }
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void historyQuery.fetchNextPage();
      },
      { rootMargin: "240px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    historyQuery.fetchNextPage,
    historyQuery.hasNextPage,
    historyQuery.isFetchNextPageError,
    historyQuery.isFetchingNextPage,
    isMobile,
  ]);

  const sidebar = balanceQuery.isPending ? (
    <Skeleton width="100%" height={240} />
  ) : balanceQuery.isError ? (
    <Callout
      tone="critical"
      title="토큰 잔액을 불러오지 못했습니다"
      description="잠시 후 다시 시도해 주세요."
      onClick={() => void balanceQuery.refetch()}
    />
  ) : (
    <SummaryCard.Root>
      <SummaryCard.Section
        title="토큰 잔액"
        description="유효기간이 남은 토큰만 합산합니다."
      />
      <SummaryCard.Row
        label="유료 토큰"
        value={`${krw.format(balanceQuery.data.paid)}개`}
      />
      <SummaryCard.Row
        label="보너스 토큰"
        value={`${krw.format(balanceQuery.data.bonus)}개`}
      />
      <SummaryCard.Total
        label="총 잔액"
        value={`${krw.format(balanceQuery.data.total)}개`}
      />
      <ActionButton
        type="button"
        variant="brandSolid"
        onClick={() => navigate("/token/purchase")}
      >
        토큰 충전
      </ActionButton>
    </SummaryCard.Root>
  );

  return (
    <>
      <title>토큰 내역 | ESSE SION</title>
      <meta
        name="description"
        content="토큰 잔액과 구매, 환불 및 변동 내역을 확인하세요."
      />
      <ContentLayout
        breadcrumbs={[
          { label: "홈", href: "/" },
          { label: "마이페이지", href: "/my-page" },
          { label: "토큰 내역" },
        ]}
        sidebar={sidebar}
      >
        <VStack gap="x8" alignItems="stretch">
          <VStack gap="x2">
            <Text as="h1" textStyle="title1">
              토큰 내역
            </Text>
            <Text textStyle="body" color="fg.neutral-muted">
              토큰 구매와 환불 상태, 잔액 변동을 한곳에서 확인합니다.
            </Text>
          </VStack>

          <VStack gap="x4" alignItems="stretch">
            <Text as="h2" textStyle="title2">
              구매와 환불
            </Text>
            {refundableQuery.isPending ? (
              <VStack gap="x3" alignItems="stretch">
                <Skeleton width="100%" height={184} />
                <Skeleton width="100%" height={184} />
              </VStack>
            ) : refundableQuery.isError ? (
              <ContentPlaceholder
                title="토큰 구매 내역을 불러오지 못했습니다"
                description="잠시 후 다시 시도해 주세요."
                action={
                  <ActionButton
                    type="button"
                    variant="neutralOutline"
                    onClick={() => void refundableQuery.refetch()}
                  >
                    다시 시도
                  </ActionButton>
                }
              />
            ) : refundableQuery.data.length === 0 ? (
              <ContentPlaceholder
                title="토큰 구매 내역이 없습니다"
                description="토큰을 충전하면 구매와 환불 가능 상태가 표시됩니다."
                action={
                  <ActionButton
                    type="button"
                    variant="neutralOutline"
                    onClick={() => navigate("/token/purchase")}
                  >
                    토큰 충전
                  </ActionButton>
                }
              />
            ) : (
              <VStack gap="x3" alignItems="stretch">
                {refundableQuery.data.map((order) => (
                  <RefundableOrderCard
                    key={order.order_id}
                    order={order}
                    onRequest={() => setRefundTarget(order)}
                    onCancel={() => setCancelTarget(order)}
                    onOpenClaim={() =>
                      order.claim_id
                        ? navigate(`/my-page/claims/${order.claim_id}`)
                        : navigate("/my-page/claims")
                    }
                  />
                ))}
              </VStack>
            )}
          </VStack>

          <VStack gap="x4" alignItems="stretch">
            <VStack gap="x3" alignItems="stretch">
              <Text as="h2" textStyle="title2">
                변동 내역
              </Text>
              <ScrollFog direction="horizontal">
                <HStack gap="x2">
                  {HISTORY_FILTERS.map((option) => (
                    <Chip
                      key={option.value}
                      selected={historyFilter === option.value}
                      onClick={() => setHistoryFilter(option.value)}
                    >
                      {option.label}
                    </Chip>
                  ))}
                </HStack>
              </ScrollFog>
            </VStack>

            {historyQuery.isPending ? (
              <VStack gap="x3" alignItems="stretch">
                <Skeleton width="100%" height={72} />
                <Skeleton width="100%" height={72} />
                <Skeleton width="100%" height={72} />
              </VStack>
            ) : historyQuery.isError && history.length === 0 ? (
              <ContentPlaceholder
                title="토큰 변동 내역을 불러오지 못했습니다"
                description="잠시 후 다시 시도해 주세요."
                action={
                  <ActionButton
                    type="button"
                    variant="neutralOutline"
                    onClick={() => void historyQuery.refetch()}
                  >
                    다시 시도
                  </ActionButton>
                }
              />
            ) : history.length === 0 ? (
              <ContentPlaceholder
                title={
                  historyFilter === "all"
                    ? "토큰 변동 내역이 없습니다"
                    : "해당 토큰 내역이 없습니다"
                }
                description="토큰을 충전하거나 사용하면 이곳에 표시됩니다."
              />
            ) : (
              <VStack gap="x4" alignItems="stretch">
                {historyGroups.map(([date, entries]) => (
                  <VStack key={date} gap="x1" alignItems="stretch">
                    <ListHeader variant="boldSolid">{date}</ListHeader>
                    <List>
                      {entries.map((entry) => (
                        <TokenHistoryItem key={entry.id} entry={entry} />
                      ))}
                    </List>
                  </VStack>
                ))}
              </VStack>
            )}

            {historyQuery.isFetchNextPageError ? (
              <Callout
                tone="critical"
                title="다음 토큰 내역을 불러오지 못했습니다"
                description="다시 시도해 주세요."
                onClick={() => void historyQuery.fetchNextPage()}
              />
            ) : !isMobile && historyQuery.hasNextPage && history.length > 0 ? (
              <HStack justify="center" pt="x2">
                <ActionButton
                  type="button"
                  variant="neutralOutline"
                  loading={historyQuery.isFetchingNextPage}
                  onClick={() => historyQuery.fetchNextPage()}
                >
                  더 보기
                </ActionButton>
              </HStack>
            ) : null}
            {isMobile &&
            historyQuery.hasNextPage &&
            !historyQuery.isFetchNextPageError ? (
              <Box ref={sentinelRef} py="x4">
                {historyQuery.isFetchingNextPage ? (
                  <HStack justify="center">
                    <ProgressCircle aria-label="토큰 내역 더 불러오는 중" />
                  </HStack>
                ) : null}
              </Box>
            ) : null}
          </VStack>
        </VStack>

        <AlertDialog
          open={refundTarget !== null}
          onOpenChange={(open) => {
            if (!open) setRefundTarget(null);
          }}
          title="토큰 환불을 신청할까요?"
          description={refundDescription(refundTarget)}
          primaryActionProps={{
            children: "환불 신청",
            loading: requestRefund.isPending,
            onClick: (event) => {
              event.preventDefault();
              if (refundTarget)
                requestRefund.mutate({
                  body: { order_id: refundTarget.order_id },
                });
            },
          }}
          secondaryActionProps={{ children: "돌아가기" }}
        />
        <AlertDialog
          open={cancelTarget !== null}
          onOpenChange={(open) => {
            if (!open) setCancelTarget(null);
          }}
          title="토큰 환불 신청을 취소할까요?"
          description="환불 신청이 취소되며 지급된 토큰은 그대로 유지됩니다."
          primaryActionProps={{
            children: "신청 취소",
            variant: "criticalSolid",
            loading: cancelRefund.isPending,
            onClick: (event) => {
              event.preventDefault();
              if (cancelTarget?.claim_id)
                cancelRefund.mutate({
                  path: { claim_id: cancelTarget.claim_id },
                });
            },
          }}
          secondaryActionProps={{ children: "유지" }}
        />
      </ContentLayout>
    </>
  );
}

function RefundableOrderCard({
  order,
  onRequest,
  onCancel,
  onOpenClaim,
}: {
  order: RefundableTokenOrder;
  onRequest: () => void;
  onCancel: () => void;
  onOpenClaim: () => void;
}) {
  const status = refundStatus(order);
  return (
    <Box
      bg="bg.layer-default"
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="r3"
      p={{ base: "x4", md: "x5" }}
    >
      <VStack gap="x4" alignItems="stretch">
        <HStack justify="space-between" gap="x3" align="flex-start">
          <VStack gap="x1">
            <Text as="h3" textStyle="title3">
              {order.order_number}
            </Text>
            <Text textStyle="caption" color="fg.neutral-muted">
              유효기간 {formatDate(order.token_expires_at)}
            </Text>
          </VStack>
          <Badge tone={status.tone}>{status.label}</Badge>
        </HStack>
        <VStack gap="x2" alignItems="stretch">
          <SummaryRow
            label="결제 금액"
            value={`${krw.format(order.total_price)}원`}
          />
          <SummaryRow
            label="지급 유료 토큰"
            value={`${krw.format(order.paid_tokens_granted)}개`}
          />
        </VStack>
        {order.is_refundable ? (
          <ActionButton
            type="button"
            variant="neutralOutline"
            onClick={onRequest}
          >
            환불 신청
          </ActionButton>
        ) : order.reason === "pending_refund" ? (
          <HStack gap="x2" wrap>
            <ActionButton
              type="button"
              size="small"
              variant="neutralOutline"
              disabled={!order.claim_id}
              onClick={onCancel}
            >
              신청 취소
            </ActionButton>
            <ActionButton
              type="button"
              size="small"
              variant="ghost"
              onClick={onOpenClaim}
            >
              클레임 상세
            </ActionButton>
          </HStack>
        ) : (
          <Text textStyle="caption" color="fg.neutral-muted">
            {ineligibleDescription(order)}
          </Text>
        )}
      </VStack>
    </Box>
  );
}

function TokenHistoryItem({ entry }: { entry: TokenHistoryEntry }) {
  return (
    <ListItem
      title={historyTypeLabel(entry.type)}
      description={historyDescription(entry)}
      suffix={
        <Text
          textStyle="label"
          color={entry.amount > 0 ? "fg.positive" : "fg.critical"}
        >
          {entry.amount > 0 ? "+" : ""}
          {krw.format(entry.amount)}
        </Text>
      }
    />
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <HStack justify="space-between" gap="x4" align="flex-start">
      <Text textStyle="bodySm" color="fg.neutral-muted">
        {label}
      </Text>
      <Text textStyle="labelSm">{value}</Text>
    </HStack>
  );
}

function refundStatus(order: RefundableTokenOrder): {
  label: string;
  tone: "neutral" | "positive" | "informative";
} {
  if (order.is_refundable) return { label: "신청 가능", tone: "neutral" };
  if (order.reason === "pending_refund")
    return { label: "환불 신청 중", tone: "informative" };
  if (order.reason === "approved_refund")
    return { label: "환불 완료", tone: "positive" };
  return { label: "신청 불가", tone: "neutral" };
}

function ineligibleDescription(order: RefundableTokenOrder): string {
  switch (order.reason) {
    case "tokens_used":
      return "구매 후 토큰을 사용해 환불할 수 없습니다.";
    case "not_latest":
      return "가장 최근에 구매한 토큰 주문만 환불할 수 있습니다.";
    case "expired":
      return "토큰 유효기간이 만료되어 환불할 수 없습니다.";
    case "approved_refund":
      return "환불이 완료되어 지급 토큰이 회수되었습니다.";
    default:
      return "환불 가능한 유료 토큰이 없습니다.";
  }
}

function refundDescription(order: RefundableTokenOrder | null): string {
  if (!order) return "";
  return `${order.order_number}\n유료 토큰 ${krw.format(order.paid_tokens_granted)}개 · 환불 금액 ${krw.format(order.total_price)}원\n\n가장 최근 구매한 토큰을 하나도 사용하지 않은 경우에만 환불할 수 있습니다. 신청 처리 중에는 디자인 생성 등 토큰 사용이 차단됩니다.`;
}

function historyTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    purchase: "토큰 구매",
    grant: "토큰 지급",
    use: "토큰 사용",
    refund: "토큰 환불",
    admin: "관리자 조정",
  };
  return labels[type] ?? "토큰 변동";
}

function historyDescription(entry: TokenHistoryEntry): string {
  const classLabel =
    entry.token_class === "paid"
      ? "유료 토큰"
      : entry.token_class === "bonus"
        ? "보너스 토큰"
        : "무료 토큰";
  return entry.description
    ? `${classLabel} · ${entry.description}`
    : classLabel;
}

function formatDate(value: string | null): string {
  if (!value) return "없음";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

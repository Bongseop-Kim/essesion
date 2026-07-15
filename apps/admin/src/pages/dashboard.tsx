import type {
  AdminOrderSummaryOut,
  DashboardRecentQuoteOut,
} from "@essesion/api-client";
import {
  getAdminCapabilitiesOptions,
  getDashboardRecentOrdersOptions,
  getDashboardRecentQuotesOptions,
  getDashboardSummaryOptions,
} from "@essesion/api-client/query";
import {
  ActionButton,
  Callout,
  Grid,
  HStack,
  Skeleton,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";

import { formatDateTime, formatMoney } from "../shared/lib/format";
import { AdminCard } from "../shared/ui/admin-card";
import { FilterSelect } from "../shared/ui/filter-select";
import { RouteHeading } from "../shared/ui/route-heading";
import { StatusBadge } from "../shared/ui/status-badge";
import {
  AdminTable,
  type AdminTableColumn,
} from "../widgets/admin-table/admin-table";

const ORDER_TYPES = [
  { value: "all", label: "전체 주문" },
  { value: "sale", label: "일반 주문" },
  { value: "custom", label: "주문 제작" },
  { value: "repair", label: "수선" },
  { value: "token", label: "토큰" },
  { value: "sample", label: "샘플" },
] as const;

type OrderType = (typeof ORDER_TYPES)[number]["value"];

const CAPABILITY_LABELS = {
  toss: "Toss 결제",
  gcs: "GCS 비공개 이미지",
  gcs_assets: "GCS 공개 에셋",
  solapi: "Solapi 알림",
  worker: "이미지 생성 Worker",
  finalize_tasks: "Finalize 작업 큐",
  batch_auth: "배치 OIDC 인증",
  oauth_google: "Google OAuth",
  oauth_kakao: "Kakao OAuth",
  auth_secrets: "인증 시크릿",
  edge_proxy: "API 엣지 프록시",
} as const;

function kstToday() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
  }).format(new Date());
}

const orderColumns: readonly AdminTableColumn<AdminOrderSummaryOut>[] = [
  {
    key: "number",
    header: "주문번호",
    render: (order) => (
      <Link to={`/orders/${order.id}`}>{order.order_number}</Link>
    ),
  },
  {
    key: "customer",
    header: "고객",
    render: (order) => order.customer.name,
  },
  {
    key: "type",
    header: "유형",
    render: (order) => order.order_type,
    visibility: "medium",
  },
  {
    key: "amount",
    header: "주문 금액",
    align: "end",
    render: (order) => formatMoney(order.order_amount),
  },
  {
    key: "status",
    header: "상태",
    render: (order) => <StatusBadge status={order.status} />,
  },
];

const quoteColumns: readonly AdminTableColumn<DashboardRecentQuoteOut>[] = [
  {
    key: "number",
    header: "견적번호",
    render: (quote) => (
      <Link to={`/quote-requests/${quote.id}`}>{quote.quote_number}</Link>
    ),
  },
  {
    key: "customer",
    header: "고객",
    render: (quote) => quote.customer.name,
  },
  {
    key: "business",
    header: "업체명",
    render: (quote) => quote.business_name,
    visibility: "medium",
  },
  {
    key: "amount",
    header: "견적 금액",
    align: "end",
    render: (quote) => formatMoney(quote.quoted_amount),
  },
  {
    key: "status",
    header: "상태",
    render: (quote) => <StatusBadge status={quote.status} />,
  },
];

function MetricCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: string;
  loading: boolean;
}) {
  return (
    <AdminCard>
      <VStack gap="x2">
        <Text textStyle="labelSm" color="fg.neutral-muted">
          {label}
        </Text>
        {loading ? (
          <Skeleton width={100} height={32} />
        ) : (
          <Text textStyle="title2">{value}</Text>
        )}
      </VStack>
    </AdminCard>
  );
}

export function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = kstToday();
  const startDate = searchParams.get("from") ?? today;
  const endDate = searchParams.get("to") ?? today;
  const requestedType = searchParams.get("type");
  const orderType = ORDER_TYPES.some((item) => item.value === requestedType)
    ? (requestedType as OrderType)
    : "all";

  const summary = useQuery({
    ...getDashboardSummaryOptions({
      query: {
        start_date: startDate,
        end_date: endDate,
        order_type: orderType,
      },
    }),
    refetchInterval: (query) =>
      document.visibilityState === "visible" &&
      (query.state.data?.open_payment_incident_count ?? 0) > 0
        ? 30_000
        : false,
  });
  const recentOrders = useQuery(
    getDashboardRecentOrdersOptions({
      query: { order_type: orderType, limit: 5 },
    }),
  );
  const recentQuotes = useQuery(
    getDashboardRecentQuotesOptions({ query: { limit: 5 } }),
  );
  const capabilities = useQuery(getAdminCapabilitiesOptions());

  const updateFilter = (key: "from" | "to" | "type", value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === "" || (key === "type" && value === "all")) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const refresh = () => {
    void Promise.all([
      summary.refetch(),
      recentOrders.refetch(),
      recentQuotes.refetch(),
      capabilities.refetch(),
    ]);
  };

  const data = summary.data;
  const capabilityEntries = Object.entries(capabilities.data ?? {}).map(
    ([key, mode]) =>
      [
        CAPABILITY_LABELS[key as keyof typeof CAPABILITY_LABELS] ?? key,
        mode,
      ] as const,
  );
  const unavailableCapabilities = capabilityEntries.filter(
    ([, mode]) => mode === "unavailable",
  );
  const fallbackCapabilities = capabilityEntries.filter(
    ([, mode]) => mode !== "real" && mode !== "ready" && mode !== "unavailable",
  );
  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title="대시보드"
          description="주요 운영 지표와 처리 대기 업무를 확인합니다."
        />
        <ActionButton
          variant="neutralOutline"
          loading={
            summary.isFetching ||
            recentOrders.isFetching ||
            recentQuotes.isFetching ||
            capabilities.isFetching
          }
          onClick={refresh}
        >
          새로고침
        </ActionButton>
      </HStack>

      <AdminCard title="조회 기준">
        <HStack gap="x3" align="flex-end" wrap>
          <TextField
            type="date"
            label="시작일 (KST)"
            value={startDate}
            max={endDate}
            onChange={(event) =>
              updateFilter("from", event.currentTarget.value)
            }
          />
          <TextField
            type="date"
            label="종료일 (KST)"
            value={endDate}
            min={startDate}
            onChange={(event) => updateFilter("to", event.currentTarget.value)}
          />
          <FilterSelect
            label="주문 유형"
            value={orderType}
            options={ORDER_TYPES}
            onValueChange={(value) => updateFilter("type", value)}
          />
        </HStack>
      </AdminCard>

      <AdminCard title="외부 연동 상태">
        <VStack gap="x3" alignItems="stretch">
          {capabilities.isError && (
            <Callout
              tone="critical"
              title="외부 연동 상태를 확인하지 못했습니다"
              description="금전·이미지·알림 관련 변경 전에 서버 준비 상태를 확인해 주세요."
              onClick={() => void capabilities.refetch()}
            />
          )}
          {unavailableCapabilities.length > 0 && (
            <Callout
              tone="critical"
              title="필수 연동을 사용할 수 없습니다"
              description={`${unavailableCapabilities.map(([label]) => label).join(", ")} 관련 작업은 실패 상태로 남습니다.`}
            />
          )}
          {fallbackCapabilities.length > 0 && (
            <Callout
              tone="informative"
              title="로컬·대체 연동 모드"
              description={fallbackCapabilities
                .map(([label, mode]) => `${label}: ${mode}`)
                .join(" · ")}
            />
          )}
          {capabilityEntries.length > 0 && (
            <Grid as="dl" columns={{ base: 1, sm: 2, lg: 4 }} gap="x3">
              {capabilityEntries.map(([label, mode]) => (
                <VStack as="div" key={label} gap="x1">
                  <Text as="dt" textStyle="caption" color="fg.neutral-muted">
                    {label}
                  </Text>
                  <Text as="dd" textStyle="labelSm" className="m-0">
                    {mode}
                  </Text>
                </VStack>
              ))}
            </Grid>
          )}
        </VStack>
      </AdminCard>

      {summary.isError && (
        <Callout
          tone="critical"
          title="운영 지표를 불러오지 못했습니다"
          description="필터를 확인하거나 다시 시도해 주세요."
          onClick={() => void summary.refetch()}
        />
      )}

      <Grid columns={{ base: 1, sm: 2, lg: 5 }} gap="x3">
        <MetricCard
          label="주문 금액"
          value={formatMoney(data?.order_amount)}
          loading={summary.isLoading}
        />
        <MetricCard
          label="주문 수"
          value={`${data?.order_count ?? 0}건`}
          loading={summary.isLoading}
        />
        <MetricCard
          label="미처리 클레임"
          value={`${data?.open_claim_count ?? 0}건`}
          loading={summary.isLoading}
        />
        <MetricCard
          label="미답변 문의"
          value={`${data?.unanswered_inquiry_count ?? 0}건`}
          loading={summary.isLoading}
        />
        <MetricCard
          label="미해결 결제 이상"
          value={`${data?.open_payment_incident_count ?? 0}건`}
          loading={summary.isLoading}
        />
      </Grid>

      <Text textStyle="caption" color="fg.neutral-muted" aria-live="polite">
        기준 시각 {formatDateTime(data?.as_of)} · 모든 날짜 경계는 Asia/Seoul
        기준
      </Text>

      <AdminCard title="최근 주문" action={<Link to="/orders">전체 보기</Link>}>
        <AdminTable
          label="최근 주문"
          columns={orderColumns}
          rows={recentOrders.data?.items}
          getRowKey={(row) => row.id}
          status={
            recentOrders.isLoading
              ? "loading"
              : recentOrders.isError
                ? "error"
                : "success"
          }
          total={recentOrders.data?.total}
          onRetry={() => void recentOrders.refetch()}
        />
      </AdminCard>

      <AdminCard
        title="최근 견적"
        action={<Link to="/quote-requests">전체 보기</Link>}
      >
        <AdminTable
          label="최근 견적"
          columns={quoteColumns}
          rows={recentQuotes.data?.items}
          getRowKey={(row) => row.id}
          status={
            recentQuotes.isLoading
              ? "loading"
              : recentQuotes.isError
                ? "error"
                : "success"
          }
          total={recentQuotes.data?.total}
          onRetry={() => void recentQuotes.refetch()}
        />
      </AdminCard>
    </VStack>
  );
}

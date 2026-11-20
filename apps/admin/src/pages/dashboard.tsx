import type {
  AdminOrderSummaryOut,
  DashboardRecentQuoteOut,
  DashboardTopProductOut,
  ManualOrderOut,
} from "@essesion/api-client";
import {
  getAdminCapabilitiesOptions,
  getDashboardOverviewOptions,
  getDashboardRecentOrdersOptions,
  getDashboardRecentQuotesOptions,
  listManualOrdersOptions,
} from "@essesion/api-client/query";
import {
  ActionButton,
  Badge,
  Callout,
  ContentPlaceholder,
  Grid,
  HStack,
  Icon,
  Modal,
  Skeleton,
  Text,
  TextField,
  useBreakpoint,
  VStack,
} from "@essesion/shared";
import { SignalIcon } from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { formatDate, formatDateTime, formatMoney } from "../shared/lib/format";
import {
  manualOrderKind,
  manualOrderPath,
} from "../shared/lib/manual-order-kind";
import { AdminCard } from "../shared/ui/admin-card";
import { FilterSelect } from "../shared/ui/filter-select";
import { RouteHeading } from "../shared/ui/route-heading";
import { ClaimStatusBadge, StatusBadge } from "../shared/ui/status-badge";
import {
  AdminTable,
  type AdminTableColumn,
} from "../widgets/admin-table/admin-table";
import { TrendChart } from "../widgets/dashboard-charts/trend-chart";

const ORDER_TYPES = [
  { value: "all", label: "전체 주문" },
  { value: "sale", label: "일반 주문" },
  { value: "custom", label: "주문 제작" },
  { value: "repair", label: "수선" },
  { value: "sample", label: "샘플 제작" },
  // 수기 주문은 orders가 아닌 별도 장부 — 지표에는 합산되고 '최근 주문' 표는 비운다.
  { value: "manual", label: "수기 주문" },
] as const;

type OrderType = (typeof ORDER_TYPES)[number]["value"];

const CAPABILITY_LABELS = {
  toss: "Toss 결제",
  solapi: "Solapi 알림",
  mailer: "메일 발송",
  worker: "이미지 생성 서버",
  batch_auth: "배치 작업 인증",
  oauth_google: "Google OAuth",
  oauth_kakao: "Kakao OAuth",
  oauth_naver: "Naver OAuth",
  oauth_apple: "Apple OAuth",
  auth_secrets: "인증 키",
  edge_proxy: "API 프록시",
} as const;

// API 원값(main.py `_capability`, integrations/*.capability_mode) → 화면 라벨
const CAPABILITY_MODE_LABELS: Record<string, string> = {
  real: "실제 연동",
  ready: "정상",
  unavailable: "사용 불가",
  dry_run: "테스트(실제 발송 없음)",
  local: "로컬",
  optional: "로컬(선택)",
  bypassed: "로컬(우회)",
  oidc: "OIDC",
  shared_secret: "공유 키",
};

const formatCapabilityMode = (mode: string) =>
  CAPABILITY_MODE_LABELS[mode] ?? mode;

function kstDate(daysAgo = 0) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
  }).format(new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000));
}

/** 최근 주문·견적·수기 주문의 공통 행 — 세 목록 모두 날짜·고객·금액·상태만 보여 준다(번호는 상세에서). */
type RecentRow = {
  id: string;
  href: string;
  date: string;
  customer: string;
  amount: string;
  status: ReactNode;
};

const recentColumns: readonly AdminTableColumn<RecentRow>[] = [
  { key: "date", header: "날짜", render: (row) => row.date },
  {
    key: "customer",
    header: "고객",
    render: (row) => <Link to={row.href}>{row.customer}</Link>,
  },
  { key: "amount", header: "금액", align: "end", render: (row) => row.amount },
  { key: "status", header: "상태", render: (row) => row.status },
];

const orderRow = (order: AdminOrderSummaryOut): RecentRow => ({
  id: order.id,
  href: `/orders/${order.id}`,
  date: formatDate(order.created_at),
  customer: order.customer.name,
  amount: formatMoney(order.order_amount),
  // 주문 목록과 같은 조합 — 취소 클레임이 완료돼도 주문 상태는 그대로라 클레임 뱃지가 알린다.
  status: (
    <HStack gap="x1" wrap>
      <StatusBadge status={order.status} />
      {order.claim_summary ? (
        <ClaimStatusBadge claim={order.claim_summary} />
      ) : null}
    </HStack>
  ),
});

const quoteRow = (quote: DashboardRecentQuoteOut): RecentRow => ({
  id: quote.id,
  href: `/quote-requests/${quote.id}`,
  date: formatDate(quote.created_at),
  customer: quote.customer.name,
  amount: formatMoney(quote.quoted_amount, "미책정"),
  status: <StatusBadge status={quote.status} />,
});

const manualOrderRow = (order: ManualOrderOut): RecentRow => ({
  id: order.id,
  href: manualOrderPath(manualOrderKind(order), order.id),
  date: formatDate(order.order_date),
  customer: order.customer_name,
  amount: formatMoney(order.amount - order.discount + order.shipping_fee),
  status: (
    <HStack gap="x1" wrap>
      {(
        [
          ["접수", order.is_received],
          ["결제", order.is_paid],
          ["발송 완료", order.is_confirmed],
        ] as const
      ).map(([label, checked]) => (
        <Badge key={label} tone={checked ? "positive" : "neutral"}>
          {label}
        </Badge>
      ))}
    </HStack>
  ),
});

const BRAND_COLOR = "var(--color-bg-brand-solid)";

/**
 * 매출 추이 스택 막대의 구획 — 순서·색 슬롯은 주문 유형에 고정한다.
 * 금액 순위를 따라 색이 바뀌면 같은 유형이 날마다 다른 색이 된다(palette.md).
 * 7종의 합은 API가 보장하는 대로 order_amount와 같다.
 */
const AMOUNT_SERIES = (
  [
    {
      key: "sale_amount",
      label: "일반 주문",
      color: "var(--color-bg-chart-1)",
    },
    {
      key: "custom_amount",
      label: "주문 제작",
      color: "var(--color-bg-chart-2)",
    },
    {
      key: "manual_custom_amount",
      label: "주문 제작(수기)",
      color: "var(--color-bg-chart-3)",
    },
    {
      key: "sample_amount",
      label: "샘플 제작",
      color: "var(--color-bg-chart-4)",
    },
    { key: "repair_amount", label: "수선", color: "var(--color-bg-chart-5)" },
    {
      key: "manual_repair_amount",
      label: "수선(수기)",
      color: "var(--color-bg-chart-6)",
    },
  ] as const
).map((item) => ({ ...item, kind: "bar" as const, stackId: "amount" }));

const topProductColumns: readonly AdminTableColumn<
  DashboardTopProductOut & { rank: number }
>[] = [
  {
    key: "rank",
    header: "순위",
    render: (product) => `${product.rank}위`,
  },
  {
    key: "name",
    header: "상품명",
    render: (product) => (
      <Link to={`/products/${product.product_id}`}>{product.name}</Link>
    ),
  },
  {
    key: "quantity",
    header: "판매 수량",
    align: "end",
    render: (product) => `${product.quantity.toLocaleString("ko")}개`,
  },
  {
    key: "amount",
    header: "판매 금액",
    align: "end",
    render: (product) => formatMoney(product.amount),
  },
];

function ChartCard({
  title,
  loading,
  children,
}: {
  title: string;
  loading: boolean;
  children: ReactNode;
}) {
  return (
    <AdminCard title={title}>
      {loading ? <Skeleton width="100%" height={240} /> : children}
    </AdminCard>
  );
}

function MetricCard({
  label,
  value,
  loading,
  todo = false,
}: {
  label: string;
  value: string;
  loading: boolean;
  /** 처리할 일이 남았다(1건 이상) — 카드를 경고색으로 강조한다. */
  todo?: boolean;
}) {
  return (
    <AdminCard
      p={{ base: "x3", md: "x4" }}
      {...(todo && {
        bg: "bg.critical-weak",
        className: "border border-stroke-critical",
      })}
    >
      <VStack gap="x1">
        <Text
          textStyle="caption"
          color={todo ? "fg.critical" : "fg.neutral-muted"}
          maxLines={1}
        >
          {label}
        </Text>
        {loading ? (
          <Skeleton width={64} height={24} />
        ) : (
          <Text textStyle="title3" color={todo ? "fg.critical" : undefined}>
            {value}
          </Text>
        )}
      </VStack>
    </AdminCard>
  );
}

/**
 * 최근 목록 카드 — md 이상은 표, 그 미만은 두 줄짜리 촘촘한 목록(고객·금액 / 날짜·상태).
 * 표는 최소 폭 720이라 모바일에서는 금액·상태가 가로 스크롤 뒤로 숨는다.
 */
function RecentCard({
  title,
  href,
  rows,
  total,
  query,
}: {
  title: string;
  href: string;
  rows: readonly RecentRow[] | undefined;
  total: number | undefined;
  query: { isLoading: boolean; isError: boolean; refetch: () => unknown };
}) {
  const navigate = useNavigate();
  const breakpoint = useBreakpoint();
  const compact = breakpoint === "base" || breakpoint === "sm";
  const status = query.isLoading
    ? "loading"
    : query.isError
      ? "error"
      : "success";
  return (
    <AdminCard
      title={title}
      description={compact ? undefined : "최신 5건"}
      action={<Link to={href}>전체 보기</Link>}
    >
      <AdminTable
        label={title}
        columns={recentColumns}
        rows={rows}
        getRowKey={(row) => row.id}
        onRowClick={(row) => navigate(row.href)}
        compactEmpty
        compactRow={(row) => ({
          title: row.customer,
          trailing: row.amount,
          meta: row.date,
          status: row.status,
        })}
        status={status}
        total={total}
        onRetry={() => void query.refetch()}
      />
    </AdminCard>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const breakpoint = useBreakpoint();
  const wide = breakpoint === "lg" || breakpoint === "xl";
  const [filterOpen, setFilterOpen] = useState(false);
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  // 기본 조회 기간은 최근 7일 — '오늘'만 보면 지표 0건과 최근 주문 목록이 어긋나 보인다
  const startDate = searchParams.get("from") ?? kstDate(6);
  const endDate = searchParams.get("to") ?? kstDate();
  const requestedType = searchParams.get("type");
  const orderType = ORDER_TYPES.some((item) => item.value === requestedType)
    ? (requestedType as OrderType)
    : "all";

  // 같은 기간 파라미터를 쓰는 요약·추이·인기 상품은 overview 한 요청으로 (perf 플랜 20번).
  const overview = useQuery({
    ...getDashboardOverviewOptions({
      query: {
        start_date: startDate,
        end_date: endDate,
        order_type: orderType,
        top_limit: 5,
      },
    }),
    refetchInterval: (query) =>
      document.visibilityState === "visible" &&
      (query.state.data?.summary.open_payment_incident_count ?? 0) > 0
        ? 30_000
        : false,
  });
  const summary = { ...overview, data: overview.data?.summary };
  const timeseries = { ...overview, data: overview.data?.timeseries };
  const topProducts = { ...overview, data: overview.data?.top_products };
  const recentOrders = useQuery(
    getDashboardRecentOrdersOptions({
      query: { order_type: orderType, limit: 5 },
    }),
  );
  // 수기 주문은 대시보드 지표에 합산되지만 orders 표에는 못 들어간다(주문번호·상태머신이
  // 없는 별도 장부) — 기존 목록 엔드포인트를 그대로 재사용해 자기 표로 보여준다.
  const recentManualOrders = useQuery(
    listManualOrdersOptions({ query: { limit: 5 } }),
  );
  const recentQuotes = useQuery(
    getDashboardRecentQuotesOptions({ query: { limit: 5 } }),
  );
  const capabilities = useQuery(getAdminCapabilitiesOptions());

  // 필터가 모달 뒤에 있어도 기본값에서 벗어난 조건 수는 버튼에 남긴다
  const activeFilterCount =
    Number(searchParams.has("from")) +
    Number(searchParams.has("to")) +
    Number(orderType !== "all");

  const updateFilter = (key: "from" | "to" | "type", value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === "" || (key === "type" && value === "all")) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const points = timeseries.data?.points ?? [];
  const rankedProducts = (topProducts.data?.items ?? []).map(
    (product, index) => ({ ...product, rank: index + 1 }),
  );

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
        <RouteHeading title="대시보드" />
        <HStack gap="x2">
          <ActionButton
            variant="neutralOutline"
            aria-haspopup="dialog"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen(true)}
          >
            필터{activeFilterCount > 0 ? ` ${activeFilterCount}` : ""}
          </ActionButton>
          <ActionButton
            variant="neutralOutline"
            iconOnly
            aria-label="외부 연동 상태"
            onClick={() => setCapabilitiesOpen(true)}
          >
            <Icon svg={<SignalIcon />} size={20} />
          </ActionButton>
        </HStack>
      </HStack>

      <Modal open={filterOpen} onOpenChange={setFilterOpen} title="조회 기준">
        <VStack gap="x4" alignItems="stretch">
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
          {/* 모달 안이라 피커(모달)를 또 열지 않는다 — 라디오 목록으로 바로 고른다 */}
          <FilterSelect
            label="주문 유형"
            presentation="inline"
            value={orderType}
            options={ORDER_TYPES}
            onValueChange={(value) => updateFilter("type", value)}
          />
        </VStack>
      </Modal>

      {/* 연동 상태 상세는 모달로 숨기되, 작업이 실패하는 상태는 항상 화면에 남긴다 */}
      {capabilities.isError && (
        <Callout
          tone="critical"
          title="외부 연동 상태를 확인하지 못했습니다"
          description="결제·이미지·알림 작업 전에 다시 확인해 주세요."
          onClick={() => void capabilities.refetch()}
        />
      )}
      {unavailableCapabilities.length > 0 && (
        <Callout
          tone="critical"
          title="필수 연동을 사용할 수 없습니다"
          description={`${unavailableCapabilities.map(([label]) => label).join(", ")} 관련 작업이 실패합니다. 개발팀에 알려 주세요.`}
        />
      )}
      <Modal
        open={capabilitiesOpen}
        onOpenChange={setCapabilitiesOpen}
        title="외부 연동 상태"
      >
        <VStack gap="x3" alignItems="stretch">
          {fallbackCapabilities.length > 0 && (
            <Text textStyle="caption" color="fg.neutral-muted">
              테스트 연동 —{" "}
              {fallbackCapabilities
                .map(
                  ([label, mode]) => `${label}: ${formatCapabilityMode(mode)}`,
                )
                .join(" · ")}
            </Text>
          )}
          {capabilityEntries.length > 0 && (
            <Grid as="dl" columns={{ base: 1, sm: 2, lg: 4 }} gap="x3">
              {capabilityEntries.map(([label, mode]) => (
                <VStack as="div" key={label} gap="x1">
                  <Text as="dt" textStyle="caption" color="fg.neutral-muted">
                    {label}
                  </Text>
                  <Text as="dd" textStyle="labelSm" className="m-0">
                    {formatCapabilityMode(mode)}
                  </Text>
                </VStack>
              ))}
            </Grid>
          )}
        </VStack>
      </Modal>

      {summary.isError ? (
        <ContentPlaceholder
          title="운영 지표를 불러오지 못했습니다"
          description="필터를 확인하거나 다시 시도해 주세요."
          action={
            <ActionButton
              variant="neutralOutline"
              onClick={() => void summary.refetch()}
            >
              다시 시도
            </ActionButton>
          }
        />
      ) : (
        // 모바일은 성과 2칸 + 할 일 3칸 두 줄, lg는 한 줄 — 칸을 작게 유지한다
        <Grid templateColumns={wide ? "2fr 3fr" : "1fr"} gap="x2">
          <Grid columns={2} gap="x2">
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
          </Grid>
          <Grid columns={3} gap="x2">
            <MetricCard
              label="미처리 클레임"
              value={`${data?.open_claim_count ?? 0}건`}
              loading={summary.isLoading}
              todo={(data?.open_claim_count ?? 0) > 0}
            />
            <MetricCard
              label="미답변 문의"
              value={`${data?.unanswered_inquiry_count ?? 0}건`}
              loading={summary.isLoading}
              todo={(data?.unanswered_inquiry_count ?? 0) > 0}
            />
            <MetricCard
              label="결제 이상"
              value={`${data?.open_payment_incident_count ?? 0}건`}
              loading={summary.isLoading}
              todo={(data?.open_payment_incident_count ?? 0) > 0}
            />
          </Grid>
        </Grid>
      )}

      <Text textStyle="caption" color="fg.neutral-muted" aria-live="polite">
        조회 기간 {startDate} ~ {endDate} · 기준 시각{" "}
        {formatDateTime(data?.as_of)}
      </Text>

      <RecentCard
        title="최근 주문"
        href="/orders"
        rows={recentOrders.data?.items.map(orderRow)}
        total={recentOrders.data?.total}
        query={recentOrders}
      />
      <RecentCard
        title="최근 견적"
        href="/quote-requests"
        rows={recentQuotes.data?.items.map(quoteRow)}
        total={recentQuotes.data?.total}
        query={recentQuotes}
      />
      <RecentCard
        title="최근 수기 주문"
        href="/manual-orders"
        rows={recentManualOrders.data?.items.map(manualOrderRow)}
        total={recentManualOrders.data?.total}
        query={recentManualOrders}
      />

      {timeseries.isError ? (
        <ContentPlaceholder
          title="일별 추이를 불러오지 못했습니다"
          description="조회 기간을 확인하거나 다시 시도해 주세요. 최대 92일까지 조회할 수 있습니다."
          action={
            <ActionButton
              variant="neutralOutline"
              onClick={() => void timeseries.refetch()}
            >
              다시 시도
            </ActionButton>
          }
        />
      ) : (
        <Grid columns={{ base: 1, lg: 2 }} gap="x3">
          <ChartCard title="매출 추이" loading={timeseries.isLoading}>
            <TrendChart
              data={points}
              series={AMOUNT_SERIES}
              tooltipRows={(point) => [
                // 유형별 구획은 0원인 날을 빼서 툴팁이 7줄로 불어나지 않게 한다.
                ...AMOUNT_SERIES.filter((series) => point[series.key] > 0).map(
                  (series) => ({
                    label: series.label,
                    value: formatMoney(point[series.key]),
                    color: series.color,
                  }),
                ),
                { label: "합계", value: formatMoney(point.order_amount) },
                { label: "주문 수", value: `${point.order_count}건` },
              ]}
            />
          </ChartCard>
          <ChartCard title="신규 가입" loading={timeseries.isLoading}>
            <TrendChart
              data={points}
              series={[
                {
                  key: "new_customer_count",
                  label: "신규 가입",
                  color: BRAND_COLOR,
                  kind: "bar",
                },
              ]}
              valueFormatter={(value) => `${value.toLocaleString("ko")}명`}
            />
          </ChartCard>
        </Grid>
      )}

      <AdminCard
        title="인기 상품 TOP 5"
        description="조회 기간 내 판매 수량 기준 (주문 제작·수선 제외)"
        action={<Link to="/products">전체 보기</Link>}
      >
        <AdminTable
          label="인기 상품"
          columns={topProductColumns}
          rows={rankedProducts}
          getRowKey={(row) => String(row.product_id)}
          onRowClick={(row) => navigate(`/products/${row.product_id}`)}
          compactEmpty
          status={
            topProducts.isLoading
              ? "loading"
              : topProducts.isError
                ? "error"
                : "success"
          }
          onRetry={() => void topProducts.refetch()}
        />
      </AdminCard>
    </VStack>
  );
}

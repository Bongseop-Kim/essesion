import type { ManualOrderOut } from "@essesion/api-client";
import { listManualOrdersOptions } from "@essesion/api-client/query";
import { ActionButton, Badge, HStack, Text, VStack } from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { formatDate, formatMoney } from "../../shared/lib/format";
import {
  useAdminListPageCorrection,
  useAdminListUrlState,
} from "../../shared/lib/use-admin-list-url-state";
import { AppliedFilterBar } from "../../shared/ui/applied-filter-bar";
import { CompactFilterToolbar } from "../../shared/ui/compact-filter-toolbar";
import { DateRangeFilters } from "../../shared/ui/date-range-filters";
import { RouteHeading } from "../../shared/ui/route-heading";
import { SubmittedMemorySearch } from "../../shared/ui/submitted-memory-search";
import type { AdminTableColumn } from "../../widgets/admin-table/admin-table";
import { PaginatedAdminTableCard } from "../../widgets/admin-table/paginated-admin-table-card";

function StatusChecks({ order }: { order: ManualOrderOut }) {
  const flags = [
    ["접수", order.is_received],
    ["결제", order.is_paid],
    ["확인", order.is_confirmed],
  ] as const;
  return (
    <HStack gap="x1" wrap>
      {flags.map(([label, checked]) => (
        <Badge key={label} tone={checked ? "positive" : "neutral"}>
          {label}
        </Badge>
      ))}
    </HStack>
  );
}

const columns: readonly AdminTableColumn<ManualOrderOut>[] = [
  {
    key: "order_date",
    header: "날짜",
    render: (order) => formatDate(order.order_date),
  },
  {
    key: "customer",
    header: "고객",
    render: (order) => (
      <VStack gap="x0_5">
        <Link to={`/manual-orders/${order.id}`}>{order.customer_name}</Link>
        <Text textStyle="caption" color="fg.neutral-muted">
          {order.phone}
        </Text>
      </VStack>
    ),
  },
  {
    key: "amount",
    header: "금액",
    align: "end",
    render: (order) => (
      <VStack gap="x0_5" alignItems="flex-end">
        <Text textStyle="bodySm">{formatMoney(order.amount)}</Text>
        <Text textStyle="caption" color="fg.neutral-muted">
          택배비 {formatMoney(order.shipping_fee)}
        </Text>
      </VStack>
    ),
  },
  {
    key: "items",
    header: "품목",
    visibility: "medium",
    render: (order) => `${order.items.length}건`,
  },
  {
    key: "status",
    header: "상태",
    render: (order) => <StatusChecks order={order} />,
  },
];

export function ManualOrdersPage() {
  const navigate = useNavigate();
  const { query: parsed, replaceQuery } = useAdminListUrlState();
  const [search, setSearch] = useState<string>();
  const [searchResetKey, setSearchResetKey] = useState(0);
  const [draftFrom, setDraftFrom] = useState(parsed.from);
  const [draftTo, setDraftTo] = useState(parsed.to);

  const query = useQuery({
    ...listManualOrdersOptions({
      query: {
        q: search,
        start_date: parsed.from,
        end_date: parsed.to,
        limit: parsed.limit,
        offset: (parsed.page - 1) * parsed.limit,
      },
    }),
    placeholderData: keepPreviousData,
  });

  const totalPages = Math.max(
    1,
    Math.ceil((query.data?.total ?? 0) / parsed.limit),
  );
  useAdminListPageCorrection({
    page: parsed.page,
    limit: parsed.limit,
    total: query.data?.total,
    ready: query.isSuccess && !query.isPlaceholderData,
    replaceQuery,
  });

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title="수기 주문"
          description="무통장 입금·전화로 접수한 작업지시서를 관리합니다."
        />
        <ActionButton onClick={() => navigate("/manual-orders/new")}>
          수기 주문 등록
        </ActionButton>
      </HStack>

      <PaginatedAdminTableCard
        title="수기 주문 목록"
        label="수기 주문 목록"
        columns={columns}
        rows={query.data?.items}
        getRowKey={(row) => row.id}
        onRowClick={(row) => navigate(`/manual-orders/${row.id}`)}
        status={
          query.isLoading || query.isPlaceholderData
            ? "loading"
            : query.isError
              ? "error"
              : "success"
        }
        total={query.data?.total}
        limit={parsed.limit}
        refreshing={query.isFetching}
        onRefresh={() => void query.refetch()}
        emptyTitle="조건에 맞는 수기 주문이 없습니다"
        page={Math.min(parsed.page, totalPages)}
        totalPages={totalPages}
        onPageChange={(page) => replaceQuery({ page })}
        paginationLabel="수기 주문 목록 페이지"
        toolbar={
          <VStack gap="x3" alignItems="stretch">
            <CompactFilterToolbar
              primaryControls={
                <SubmittedMemorySearch
                  label="고객 검색"
                  placeholder="이름 또는 휴대폰, 2자 이상 입력"
                  maxLength={64}
                  resetKey={searchResetKey}
                  onSubmit={(value) => {
                    setSearch(value);
                    replaceQuery({ page: 1 });
                  }}
                />
              }
              secondaryFilters={
                <VStack gap="x4" alignItems="stretch">
                  <DateRangeFilters
                    presentation="inline"
                    from={draftFrom}
                    to={draftTo}
                    onFromChange={setDraftFrom}
                    onToChange={setDraftTo}
                  />
                </VStack>
              }
              secondaryFilterCount={Number(
                parsed.from !== undefined || parsed.to !== undefined,
              )}
              onOpenSecondaryFilters={() => {
                setDraftFrom(parsed.from);
                setDraftTo(parsed.to);
              }}
              onCancelSecondaryFilters={() => {
                setDraftFrom(parsed.from);
                setDraftTo(parsed.to);
              }}
              onApplySecondaryFilters={() => {
                replaceQuery({ from: draftFrom, to: draftTo, page: 1 });
              }}
            />
            <AppliedFilterBar
              filters={[
                search !== undefined && {
                  key: "search",
                  label: `검색: ${search}`,
                  onRemove: () => {
                    setSearch(undefined);
                    setSearchResetKey((current) => current + 1);
                    replaceQuery({ page: 1 });
                  },
                },
                parsed.from !== undefined && {
                  key: "from",
                  label: `시작일: ${parsed.from}`,
                  onRemove: () => replaceQuery({ from: undefined, page: 1 }),
                },
                parsed.to !== undefined && {
                  key: "to",
                  label: `종료일: ${parsed.to}`,
                  onRemove: () => replaceQuery({ to: undefined, page: 1 }),
                },
              ]}
              onReset={() => {
                setSearch(undefined);
                setSearchResetKey((current) => current + 1);
                replaceQuery({
                  page: 1,
                  limit: 20,
                  sort: undefined,
                  direction: "asc",
                  status: undefined,
                  type: undefined,
                  from: undefined,
                  to: undefined,
                });
              }}
            />
          </VStack>
        }
      />
    </VStack>
  );
}

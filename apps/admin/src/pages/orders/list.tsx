import type { AdminOrderSummaryOut } from "@essesion/api-client";
import { listAllOrdersOptions } from "@essesion/api-client/query";
import { HStack, Text, VStack } from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import {
  formatDateTime,
  formatMoney,
  formatOrderType,
} from "../../shared/lib/format";
import {
  useAdminListPageCorrection,
  useAdminListUrlState,
} from "../../shared/lib/use-admin-list-url-state";
import { AppliedFilterBar } from "../../shared/ui/applied-filter-bar";
import { CompactFilterToolbar } from "../../shared/ui/compact-filter-toolbar";
import { DateRangeFilters } from "../../shared/ui/date-range-filters";
import { FilterSelect } from "../../shared/ui/filter-select";
import { RouteHeading } from "../../shared/ui/route-heading";
import { ClaimStatusBadge, StatusBadge } from "../../shared/ui/status-badge";
import { SubmittedMemorySearch } from "../../shared/ui/submitted-memory-search";
import type { AdminTableColumn } from "../../widgets/admin-table/admin-table";
import { PaginatedAdminTableCard } from "../../widgets/admin-table/paginated-admin-table-card";

const ORDER_TYPE_VALUES = [
  "all",
  "sale",
  "custom",
  "repair",
  "token",
  "sample",
] as const;
const ORDER_TYPES = ORDER_TYPE_VALUES.map((value) => ({
  value,
  label: value === "all" ? "전체" : formatOrderType(value),
}));
const ORDER_STATUSES = [
  "all",
  "대기중",
  "결제중",
  "진행중",
  "배송중",
  "배송완료",
  "완료",
  "취소",
  "실패",
  "접수",
  "제작중",
  "제작완료",
  "수선중",
  "수선완료",
  "발송대기",
  "발송중",
  "발송확인중",
  "수거예정",
] as const;
const ORDER_SORTS = [
  "created_at",
  "updated_at",
  "order_number",
  "order_amount",
  "status",
] as const;

type OrderType = (typeof ORDER_TYPE_VALUES)[number];
type OrderStatus = (typeof ORDER_STATUSES)[number];
type OrderSort = (typeof ORDER_SORTS)[number];

const columns: readonly AdminTableColumn<AdminOrderSummaryOut>[] = [
  {
    key: "order_number",
    header: "주문번호",
    sortable: true,
    render: (order) => (
      <Link to={`/orders/${order.id}`}>{order.order_number}</Link>
    ),
  },
  {
    key: "customer",
    header: "고객",
    render: (order) => (
      <VStack gap="x0_5">
        <Text textStyle="bodySm">{order.customer.name}</Text>
        <Text textStyle="caption" color="fg.neutral-muted">
          {order.customer.email ?? "이메일 없음"}
        </Text>
      </VStack>
    ),
  },
  {
    key: "order_type",
    header: "유형",
    visibility: "medium",
    render: (order) => formatOrderType(order.order_type),
  },
  {
    key: "order_amount",
    header: "주문 금액",
    sortable: true,
    align: "end",
    render: (order) => formatMoney(order.order_amount),
  },
  {
    key: "status",
    header: "상태",
    sortable: true,
    render: (order) => (
      <HStack gap="x1" wrap>
        <StatusBadge status={order.status} />
        {order.claim_summary ? (
          <ClaimStatusBadge claim={order.claim_summary} />
        ) : null}
      </HStack>
    ),
  },
  {
    key: "created_at",
    header: "주문일",
    sortable: true,
    visibility: "large",
    render: (order) => formatDateTime(order.created_at),
  },
];

export function OrdersPage() {
  const navigate = useNavigate();
  const { query: parsed, replaceQuery } = useAdminListUrlState({
    allowedSorts: ORDER_SORTS,
    allowedStatuses: ORDER_STATUSES,
    allowedTypes: ORDER_TYPES.map((item) => item.value),
    defaultSort: "created_at",
    defaultDirection: "desc",
  });
  const [search, setSearch] = useState<string>();
  const [searchResetKey, setSearchResetKey] = useState(0);
  const orderType = (parsed.type ?? "all") as OrderType;
  const status = (parsed.status ?? "all") as OrderStatus;
  const sort = (parsed.sort ?? "created_at") as OrderSort;
  const [draftStatus, setDraftStatus] = useState<OrderStatus>(status);
  const [draftOrderType, setDraftOrderType] = useState<OrderType>(orderType);
  const [draftFrom, setDraftFrom] = useState(parsed.from);
  const [draftTo, setDraftTo] = useState(parsed.to);

  const query = useQuery({
    ...listAllOrdersOptions({
      query: {
        order_type: orderType,
        status,
        start_date: parsed.from,
        end_date: parsed.to,
        q: search,
        sort,
        direction: parsed.direction,
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
      <RouteHeading
        title="주문 관리"
        description="주문번호와 운영 상태를 기준으로 주문을 조회합니다."
      />
      <PaginatedAdminTableCard
        title="주문 목록"
        label="주문 목록"
        columns={columns}
        rows={query.data?.items}
        getRowKey={(row) => row.id}
        onRowClick={(row) => navigate(`/orders/${row.id}`)}
        status={
          query.isLoading || query.isPlaceholderData
            ? "loading"
            : query.isError
              ? "error"
              : "success"
        }
        total={query.data?.total}
        limit={parsed.limit}
        sort={{ key: sort, direction: parsed.direction }}
        onSort={({ key, direction }) =>
          replaceQuery({ sort: key, direction, page: 1 })
        }
        refreshing={query.isFetching}
        onRefresh={() => void query.refetch()}
        emptyTitle="조건에 맞는 주문이 없습니다"
        page={Math.min(parsed.page, totalPages)}
        totalPages={totalPages}
        onPageChange={(page) => replaceQuery({ page })}
        paginationLabel="주문 목록 페이지"
        toolbar={
          <VStack gap="x3" alignItems="stretch">
            <CompactFilterToolbar
              primaryControls={
                <SubmittedMemorySearch
                  label="주문번호 검색"
                  placeholder="2자 이상 입력"
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
                  <FilterSelect
                    label="상태"
                    presentation="inline"
                    value={draftStatus}
                    options={ORDER_STATUSES.map((value) => ({
                      value,
                      label: value === "all" ? "전체" : value,
                    }))}
                    onValueChange={(value) =>
                      setDraftStatus(value as OrderStatus)
                    }
                  />
                  <FilterSelect
                    label="주문 유형"
                    presentation="inline"
                    value={draftOrderType}
                    options={ORDER_TYPES}
                    onValueChange={(value) =>
                      setDraftOrderType(value as OrderType)
                    }
                  />
                  <DateRangeFilters
                    presentation="inline"
                    from={draftFrom}
                    to={draftTo}
                    onFromChange={setDraftFrom}
                    onToChange={setDraftTo}
                  />
                </VStack>
              }
              secondaryFilterCount={
                Number(status !== "all") +
                Number(orderType !== "all") +
                Number(parsed.from !== undefined) +
                Number(parsed.to !== undefined)
              }
              onOpenSecondaryFilters={() => {
                setDraftStatus(status);
                setDraftOrderType(orderType);
                setDraftFrom(parsed.from);
                setDraftTo(parsed.to);
              }}
              onCancelSecondaryFilters={() => {
                setDraftStatus(status);
                setDraftOrderType(orderType);
                setDraftFrom(parsed.from);
                setDraftTo(parsed.to);
              }}
              onApplySecondaryFilters={() => {
                replaceQuery({
                  status: draftStatus === "all" ? undefined : draftStatus,
                  type: draftOrderType === "all" ? undefined : draftOrderType,
                  from: draftFrom,
                  to: draftTo,
                  page: 1,
                });
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
                orderType !== "all" && {
                  key: "type",
                  label: `유형: ${ORDER_TYPES.find((item) => item.value === orderType)?.label ?? orderType}`,
                  onRemove: () => replaceQuery({ type: undefined, page: 1 }),
                },
                status !== "all" && {
                  key: "status",
                  label: `상태: ${status}`,
                  onRemove: () => replaceQuery({ status: undefined, page: 1 }),
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
                  sort: "created_at",
                  direction: "desc",
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

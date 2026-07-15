import type { AdminOrderSummaryOut } from "@essesion/api-client";
import { listAllOrdersOptions } from "@essesion/api-client/query";
import { HStack, Text, VStack } from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { formatDateTime, formatMoney } from "../../shared/lib/format";
import {
  useAdminListPageCorrection,
  useAdminListUrlState,
} from "../../shared/lib/use-admin-list-url-state";
import { AdminCard } from "../../shared/ui/admin-card";
import { DateRangeFilters } from "../../shared/ui/date-range-filters";
import { FilterSelect } from "../../shared/ui/filter-select";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";
import { SubmittedMemorySearch } from "../../shared/ui/submitted-memory-search";
import type { AdminTableColumn } from "../../widgets/admin-table/admin-table";
import { PaginatedAdminTableCard } from "../../widgets/admin-table/paginated-admin-table-card";

const ORDER_TYPES = [
  { value: "all", label: "전체" },
  { value: "sale", label: "일반" },
  { value: "custom", label: "주문 제작" },
  { value: "repair", label: "수선" },
  { value: "token", label: "토큰" },
  { value: "sample", label: "샘플" },
] as const;
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

type OrderType = (typeof ORDER_TYPES)[number]["value"];
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
    render: (order) => order.order_type,
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
    render: (order) => <StatusBadge status={order.status} />,
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
  const { query: parsed, replaceQuery } = useAdminListUrlState({
    allowedSorts: ORDER_SORTS,
    allowedStatuses: ORDER_STATUSES,
    allowedTypes: ORDER_TYPES.map((item) => item.value),
    defaultSort: "created_at",
    defaultDirection: "desc",
  });
  const [search, setSearch] = useState<string>();
  const orderType = (parsed.type ?? "all") as OrderType;
  const status = (parsed.status ?? "all") as OrderStatus;
  const sort = (parsed.sort ?? "created_at") as OrderSort;

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
      <AdminCard title="검색·필터">
        <VStack gap="x4" alignItems="stretch">
          <SubmittedMemorySearch
            label="주문번호 검색"
            description="2자 이상 입력해 주세요. 검색어는 URL에 저장하지 않습니다."
            maxLength={64}
            onSubmit={(value) => {
              setSearch(value);
              replaceQuery({ page: 1 });
            }}
          />
          <HStack gap="x3" align="flex-end" wrap>
            <FilterSelect
              label="주문 유형"
              value={orderType}
              options={ORDER_TYPES}
              onValueChange={(value) => replaceQuery({ type: value, page: 1 })}
            />
            <FilterSelect
              label="상태"
              value={status}
              options={ORDER_STATUSES.map((value) => ({
                value,
                label: value === "all" ? "전체" : value,
              }))}
              onValueChange={(value) =>
                replaceQuery({ status: value, page: 1 })
              }
            />
            <DateRangeFilters
              from={parsed.from}
              to={parsed.to}
              onFromChange={(from) => replaceQuery({ from, page: 1 })}
              onToChange={(to) => replaceQuery({ to, page: 1 })}
            />
          </HStack>
        </VStack>
      </AdminCard>

      <PaginatedAdminTableCard
        title="주문 목록"
        description={`총 ${query.data?.total ?? 0}건`}
        label="주문 목록"
        columns={columns}
        rows={query.data?.items}
        getRowKey={(row) => row.id}
        status={
          query.isLoading ? "loading" : query.isError ? "error" : "success"
        }
        total={query.data?.total}
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
      />
    </VStack>
  );
}

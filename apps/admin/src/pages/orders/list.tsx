import type { AdminOrderSummaryOut } from "@essesion/api-client";
import { listAllOrdersOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  HStack,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { formatDateTime, formatMoney } from "../../shared/lib/format";
import {
  parseAdminListQuery,
  serializeAdminListQuery,
} from "../../shared/lib/url-query";
import { AdminCard } from "../../shared/ui/admin-card";
import { FilterSelect } from "../../shared/ui/filter-select";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";
import {
  AdminTable,
  type AdminTableColumn,
} from "../../widgets/admin-table/admin-table";
import { Pagination } from "../../widgets/admin-table/pagination";

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
  const [params, setParams] = useSearchParams();
  const parsed = parseAdminListQuery(params, {
    allowedSorts: ORDER_SORTS,
    allowedStatuses: ORDER_STATUSES,
    allowedTypes: ORDER_TYPES.map((item) => item.value),
    defaultSort: "created_at",
    defaultDirection: "desc",
  });
  const [searchInput, setSearchInput] = useState("");
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

  const replaceQuery = (changes: Partial<typeof parsed>) => {
    setParams(serializeAdminListQuery({ ...parsed, ...changes }), {
      replace: true,
    });
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const value = searchInput.trim();
    setSearch(value.length >= 2 ? value : undefined);
    replaceQuery({ page: 1 });
  };

  const totalPages = Math.max(
    1,
    Math.ceil((query.data?.total ?? 0) / parsed.limit),
  );

  return (
    <VStack gap="x6" alignItems="stretch">
      <RouteHeading
        title="주문 관리"
        description="주문번호와 운영 상태를 기준으로 주문을 조회합니다."
      />
      <AdminCard title="검색·필터">
        <VStack gap="x4" alignItems="stretch">
          <HStack
            as="form"
            gap="x2"
            align="flex-end"
            wrap
            onSubmit={submitSearch}
          >
            <TextField
              label="주문번호 검색"
              description="2자 이상 입력해 주세요. 검색어는 URL에 저장하지 않습니다."
              value={searchInput}
              maxLength={64}
              onChange={(event) => setSearchInput(event.currentTarget.value)}
            />
            <ActionButton type="submit" variant="neutralOutline">
              검색
            </ActionButton>
            {search !== undefined && (
              <ActionButton
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearchInput("");
                  setSearch(undefined);
                }}
              >
                검색 초기화
              </ActionButton>
            )}
          </HStack>
          <HStack gap="x3" align="flex-end" wrap>
            <FilterSelect
              label="주문 유형"
              value={orderType}
              options={ORDER_TYPES}
              onChange={(event) =>
                replaceQuery({ type: event.currentTarget.value, page: 1 })
              }
            />
            <FilterSelect
              label="상태"
              value={status}
              options={ORDER_STATUSES.map((value) => ({
                value,
                label: value === "all" ? "전체" : value,
              }))}
              onChange={(event) =>
                replaceQuery({ status: event.currentTarget.value, page: 1 })
              }
            />
            <TextField
              type="date"
              label="시작일 (KST)"
              value={parsed.from ?? ""}
              onChange={(event) =>
                replaceQuery({
                  from: event.currentTarget.value || undefined,
                  page: 1,
                })
              }
            />
            <TextField
              type="date"
              label="종료일 (KST)"
              value={parsed.to ?? ""}
              onChange={(event) =>
                replaceQuery({
                  to: event.currentTarget.value || undefined,
                  page: 1,
                })
              }
            />
          </HStack>
        </VStack>
      </AdminCard>

      <AdminCard
        title="주문 목록"
        description={`총 ${query.data?.total ?? 0}건`}
        action={
          <ActionButton
            variant="ghost"
            size="small"
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            새로고침
          </ActionButton>
        }
      >
        <VStack gap="x4" alignItems="stretch">
          <AdminTable
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
            onRetry={() => void query.refetch()}
            emptyTitle="조건에 맞는 주문이 없습니다"
          />
          <Pagination
            page={Math.min(parsed.page, totalPages)}
            totalPages={totalPages}
            onPageChange={(page) => replaceQuery({ page })}
            label="주문 목록 페이지"
          />
        </VStack>
      </AdminCard>
    </VStack>
  );
}

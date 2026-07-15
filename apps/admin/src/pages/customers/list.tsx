import type {
  AdminCustomerSummaryOut,
  PageAdminCustomerSummaryOut,
} from "@essesion/api-client";
import { listAdminCustomers, searchAdminCustomers } from "@essesion/api-client";
import {
  ActionButton,
  HStack,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";

import { formatDateTime } from "../../shared/lib/format";
import {
  useAdminListPageCorrection,
  useAdminListUrlState,
} from "../../shared/lib/use-admin-list-url-state";
import { AdminCard } from "../../shared/ui/admin-card";
import { FilterSelect } from "../../shared/ui/filter-select";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";
import type { AdminTableColumn } from "../../widgets/admin-table/admin-table";
import { PaginatedAdminTableCard } from "../../widgets/admin-table/paginated-admin-table-card";

const CUSTOMER_STATUSES = ["all", "active", "inactive"] as const;
const CUSTOMER_SORTS = ["created_at", "name"] as const;

type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];
type CustomerSort = (typeof CUSTOMER_SORTS)[number];

const columns: readonly AdminTableColumn<AdminCustomerSummaryOut>[] = [
  {
    key: "name",
    header: "고객",
    sortable: true,
    render: (customer) => (
      <VStack gap="x0_5">
        <Link to={`/customers/${customer.id}`}>{customer.name}</Link>
        <Text textStyle="caption" color="fg.neutral-muted">
          {customer.email ?? "이메일 없음"}
        </Text>
      </VStack>
    ),
  },
  {
    key: "phone",
    header: "전화번호",
    render: (customer) => customer.phone ?? "-",
  },
  {
    key: "status",
    header: "상태",
    render: (customer) => (
      <StatusBadge status={customer.is_active ? "활성" : "비활성"} />
    ),
  },
  {
    key: "token",
    header: "토큰",
    align: "end",
    render: (customer) => `${customer.token_balance.toLocaleString("ko-KR")}개`,
  },
  {
    key: "orders",
    header: "주문",
    align: "end",
    visibility: "medium",
    render: (customer) => `${customer.order_count.toLocaleString("ko-KR")}건`,
  },
  {
    key: "coupons",
    header: "사용 가능 쿠폰",
    align: "end",
    visibility: "large",
    render: (customer) =>
      `${customer.active_coupon_count.toLocaleString("ko-KR")}개`,
  },
  {
    key: "created_at",
    header: "가입일",
    sortable: true,
    visibility: "large",
    render: (customer) => formatDateTime(customer.created_at),
  },
];

export function CustomersPage() {
  const navigate = useNavigate();
  const { query: parsed, replaceQuery } = useAdminListUrlState({
    allowedSorts: CUSTOMER_SORTS,
    allowedStatuses: CUSTOMER_STATUSES,
    defaultSort: "created_at",
    defaultDirection: "desc",
  });
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState<string>();
  const status = (parsed.status ?? "all") as CustomerStatus;
  const sort = (parsed.sort ?? "created_at") as CustomerSort;
  const offset = (parsed.page - 1) * parsed.limit;

  const query = useQuery<PageAdminCustomerSummaryOut>({
    queryKey: [
      "admin-customers",
      {
        status,
        sort,
        direction: parsed.direction,
        limit: parsed.limit,
        offset,
        search,
      },
    ],
    queryFn: async ({ signal }) => {
      if (search !== undefined) {
        const { data } = await searchAdminCustomers({
          body: {
            q: search,
            status,
            sort,
            direction: parsed.direction,
            limit: parsed.limit,
            offset,
          },
          signal,
          throwOnError: true,
        });
        return data;
      }
      const { data } = await listAdminCustomers({
        query: {
          status,
          sort,
          direction: parsed.direction,
          limit: parsed.limit,
          offset,
        },
        signal,
        throwOnError: true,
      });
      return data;
    },
    placeholderData: keepPreviousData,
  });

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const value = searchInput.trim();
    if (value.length < 2) return;
    setSearch(value);
    replaceQuery({ page: 1 });
  };

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
        title="고객 관리"
        description="customer 역할 계정만 조회하며 개인정보 검색어는 브라우저 주소에 남기지 않습니다."
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
              label="이름·이메일·전화번호 검색"
              placeholder="2자 이상 입력"
              value={searchInput}
              minLength={2}
              maxLength={100}
              onChange={(event) => setSearchInput(event.currentTarget.value)}
            />
            <ActionButton
              type="submit"
              variant="neutralOutline"
              disabled={searchInput.trim().length < 2}
            >
              검색
            </ActionButton>
            {search !== undefined && (
              <ActionButton
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearchInput("");
                  setSearch(undefined);
                  replaceQuery({ page: 1 });
                }}
              >
                검색 초기화
              </ActionButton>
            )}
          </HStack>
          <HStack gap="x3" align="flex-end" wrap>
            <FilterSelect
              label="계정 상태"
              value={status}
              options={[
                { value: "all", label: "전체" },
                { value: "active", label: "활성" },
                { value: "inactive", label: "비활성" },
              ]}
              onValueChange={(value) =>
                replaceQuery({ status: value, page: 1 })
              }
            />
            <FilterSelect
              label="정렬"
              value={sort}
              options={[
                { value: "created_at", label: "가입일" },
                { value: "name", label: "이름" },
              ]}
              onValueChange={(value) => replaceQuery({ sort: value, page: 1 })}
            />
          </HStack>
        </VStack>
      </AdminCard>

      <PaginatedAdminTableCard
        title="고객 목록"
        description={`총 ${query.data?.total ?? 0}명`}
        label="고객 목록"
        columns={columns}
        rows={query.data?.items}
        getRowKey={(row) => row.id}
        onRowClick={(row) => navigate(`/customers/${row.id}`)}
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
        emptyTitle="조건에 맞는 고객이 없습니다"
        page={Math.min(parsed.page, totalPages)}
        totalPages={totalPages}
        onPageChange={(page) => replaceQuery({ page })}
        paginationLabel="고객 목록 페이지"
      />
    </VStack>
  );
}

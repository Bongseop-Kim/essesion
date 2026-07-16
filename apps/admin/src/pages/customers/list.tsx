import type {
  AdminCustomerSummaryOut,
  PageAdminCustomerSummaryOut,
} from "@essesion/api-client";
import { listAdminCustomers, searchAdminCustomers } from "@essesion/api-client";
import { Text, VStack } from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { formatDateTime } from "../../shared/lib/format";
import {
  useAdminListPageCorrection,
  useAdminListUrlState,
} from "../../shared/lib/use-admin-list-url-state";
import { AppliedFilterBar } from "../../shared/ui/applied-filter-bar";
import { CompactFilterToolbar } from "../../shared/ui/compact-filter-toolbar";
import { DateRangeFilters } from "../../shared/ui/date-range-filters";
import { FilterSelect } from "../../shared/ui/filter-select";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";
import { SubmittedMemorySearch } from "../../shared/ui/submitted-memory-search";
import type { AdminTableColumn } from "../../widgets/admin-table/admin-table";
import { PaginatedAdminTableCard } from "../../widgets/admin-table/paginated-admin-table-card";

const CUSTOMER_STATUSES = ["all", "active", "inactive"] as const;
const CUSTOMER_SORTS = ["created_at", "name"] as const;

type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];
type CustomerSort = (typeof CUSTOMER_SORTS)[number];

const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  all: "전체",
  active: "활성",
  inactive: "비활성",
};

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
  const [search, setSearch] = useState<string>();
  const [searchResetKey, setSearchResetKey] = useState(0);
  const status = (parsed.status ?? "all") as CustomerStatus;
  const sort = (parsed.sort ?? "created_at") as CustomerSort;
  const [draftStatus, setDraftStatus] = useState(status);
  const [draftFrom, setDraftFrom] = useState<string | undefined>(parsed.from);
  const [draftTo, setDraftTo] = useState<string | undefined>(parsed.to);
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
        startDate: parsed.from,
        endDate: parsed.to,
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
            start_date: parsed.from,
            end_date: parsed.to,
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
          start_date: parsed.from,
          end_date: parsed.to,
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

      <PaginatedAdminTableCard
        title="고객 목록"
        label="고객 목록"
        columns={columns}
        rows={query.data?.items}
        getRowKey={(row) => row.id}
        onRowClick={(row) => navigate(`/customers/${row.id}`)}
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
        emptyTitle="조건에 맞는 고객이 없습니다"
        page={Math.min(parsed.page, totalPages)}
        totalPages={totalPages}
        onPageChange={(page) => replaceQuery({ page })}
        paginationLabel="고객 목록 페이지"
        toolbar={
          <VStack gap="x3" alignItems="stretch">
            <CompactFilterToolbar
              primaryControls={
                <SubmittedMemorySearch
                  label="이름·이메일·전화번호 검색"
                  placeholder="2자 이상 입력"
                  maxLength={100}
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
                    label="계정 상태"
                    presentation="inline"
                    value={draftStatus}
                    options={CUSTOMER_STATUSES.map((value) => ({
                      value,
                      label: CUSTOMER_STATUS_LABELS[value],
                    }))}
                    onValueChange={(value) =>
                      setDraftStatus(value as CustomerStatus)
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
                Number(parsed.from !== undefined) +
                Number(parsed.to !== undefined)
              }
              secondaryTitle="고객 필터"
              onOpenSecondaryFilters={() => {
                setDraftStatus(status);
                setDraftFrom(parsed.from);
                setDraftTo(parsed.to);
              }}
              onCancelSecondaryFilters={() => {
                setDraftStatus(status);
                setDraftFrom(parsed.from);
                setDraftTo(parsed.to);
              }}
              onApplySecondaryFilters={() => {
                replaceQuery({
                  status: draftStatus === "all" ? undefined : draftStatus,
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
                status !== "all" && {
                  key: "status",
                  label: `상태: ${CUSTOMER_STATUS_LABELS[status]}`,
                  onRemove: () => replaceQuery({ status: undefined, page: 1 }),
                },
                parsed.from !== undefined && {
                  key: "from",
                  label: `가입 시작일: ${parsed.from}`,
                  onRemove: () => replaceQuery({ from: undefined, page: 1 }),
                },
                parsed.to !== undefined && {
                  key: "to",
                  label: `가입 종료일: ${parsed.to}`,
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

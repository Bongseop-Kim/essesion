import type { AdminQuoteSummaryOut } from "@essesion/api-client";
import { listAdminQuotesOptions } from "@essesion/api-client/query";
import { VStack } from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { formatDateTime, formatMoney } from "../../shared/lib/format";
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

const QUOTE_STATUSES = [
  "all",
  "요청",
  "견적발송",
  "협의중",
  "확정",
  "종료",
] as const;
const QUOTE_SORTS = [
  "created_at",
  "updated_at",
  "quote_number",
  "status",
  "quoted_amount",
] as const;

type QuoteStatus = (typeof QUOTE_STATUSES)[number];
type QuoteSort = (typeof QUOTE_SORTS)[number];

const columns: readonly AdminTableColumn<AdminQuoteSummaryOut>[] = [
  {
    key: "quote_number",
    header: "견적번호",
    sortable: true,
    render: (quote) => (
      <Link to={`/quote-requests/${quote.id}`}>{quote.quote_number}</Link>
    ),
  },
  {
    key: "customer",
    header: "고객·사업자",
    render: (quote) => `${quote.customer.name} · ${quote.business_name}`,
  },
  {
    key: "quantity",
    header: "수량",
    align: "end",
    visibility: "medium",
    render: (quote) => `${quote.quantity.toLocaleString("ko-KR")}개`,
  },
  {
    key: "quoted_amount",
    header: "견적 금액",
    sortable: true,
    align: "end",
    render: (quote) => formatMoney(quote.quoted_amount),
  },
  {
    key: "status",
    header: "상태",
    sortable: true,
    render: (quote) => <StatusBadge status={quote.status} />,
  },
  {
    key: "created_at",
    header: "요청일",
    sortable: true,
    visibility: "large",
    render: (quote) => formatDateTime(quote.created_at),
  },
];

export function QuotesPage() {
  const navigate = useNavigate();
  const { query: parsed, replaceQuery } = useAdminListUrlState({
    allowedSorts: QUOTE_SORTS,
    allowedStatuses: QUOTE_STATUSES,
    defaultSort: "created_at",
    defaultDirection: "desc",
  });
  const status = (parsed.status ?? "all") as QuoteStatus;
  const sort = (parsed.sort ?? "created_at") as QuoteSort;
  const [search, setSearch] = useState<string>();
  const [searchResetKey, setSearchResetKey] = useState(0);
  const [draftStatus, setDraftStatus] = useState<QuoteStatus>(status);
  const [draftFrom, setDraftFrom] = useState(parsed.from);
  const [draftTo, setDraftTo] = useState(parsed.to);
  const query = useQuery({
    ...listAdminQuotesOptions({
      query: {
        q: search,
        status,
        start_date: parsed.from,
        end_date: parsed.to,
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
        title="견적 관리"
        description="거래 시점의 배송지와 견적 조건, 처리 이력을 함께 확인합니다."
      />
      <PaginatedAdminTableCard
        title="견적 목록"
        label="견적 목록"
        columns={columns}
        rows={query.data?.items}
        getRowKey={(row) => row.id}
        onRowClick={(row) => navigate(`/quote-requests/${row.id}`)}
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
        emptyTitle="조건에 맞는 견적이 없습니다"
        page={Math.min(parsed.page, totalPages)}
        totalPages={totalPages}
        onPageChange={(page) => replaceQuery({ page })}
        paginationLabel="견적 목록 페이지"
        toolbar={
          <VStack gap="x3" alignItems="stretch">
            <CompactFilterToolbar
              primaryControls={
                <SubmittedMemorySearch
                  label="견적번호 검색"
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
                    options={QUOTE_STATUSES.map((value) => ({
                      value,
                      label: value === "all" ? "전체" : value,
                    }))}
                    onValueChange={(value) =>
                      setDraftStatus(value as QuoteStatus)
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
              secondaryTitle="견적 필터"
              secondaryDescription="상태와 조회 기간을 한 번에 적용합니다."
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

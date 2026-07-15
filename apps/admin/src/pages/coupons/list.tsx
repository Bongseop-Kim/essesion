import type { AdminCouponOut } from "@essesion/api-client";
import { listAdminCouponsOptions } from "@essesion/api-client/query";
import { ActionButton, HStack, Text, VStack } from "@essesion/shared";
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
import { FilterSelect } from "../../shared/ui/filter-select";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";
import { SubmittedMemorySearch } from "../../shared/ui/submitted-memory-search";
import type { AdminTableColumn } from "../../widgets/admin-table/admin-table";
import { PaginatedAdminTableCard } from "../../widgets/admin-table/paginated-admin-table-card";

const COUPON_STATUSES = ["all", "active", "inactive"] as const;
const COUPON_SORTS = ["created_at", "expiry_date", "name"] as const;

type CouponStatus = (typeof COUPON_STATUSES)[number];
type CouponSort = (typeof COUPON_SORTS)[number];

function discountLabel(coupon: AdminCouponOut) {
  return coupon.discount_type === "percentage"
    ? `${Number(coupon.discount_value).toLocaleString("ko-KR")}%`
    : formatMoney(coupon.discount_value);
}

const columns: readonly AdminTableColumn<AdminCouponOut>[] = [
  {
    key: "name",
    header: "쿠폰",
    sortable: true,
    render: (coupon) => (
      <VStack gap="x0_5">
        <Link to={`/coupons/${coupon.id}`}>{coupon.name}</Link>
        <Text textStyle="caption" color="fg.neutral-muted">
          {coupon.display_name ?? "고객 표시 이름 없음"}
        </Text>
      </VStack>
    ),
  },
  {
    key: "discount",
    header: "할인 조건",
    render: (coupon) => discountLabel(coupon),
  },
  {
    key: "maximum",
    header: "최대 할인",
    visibility: "medium",
    render: (coupon) => formatMoney(coupon.max_discount_amount),
  },
  {
    key: "expiry_date",
    header: "만료일",
    sortable: true,
    render: (coupon) => formatDate(coupon.expiry_date),
  },
  {
    key: "status",
    header: "상태",
    render: (coupon) => (
      <StatusBadge status={coupon.is_active ? "active" : "inactive"} />
    ),
  },
  {
    key: "issued",
    header: "발급",
    align: "end",
    visibility: "large",
    render: (coupon) =>
      `${coupon.active_issued_count.toLocaleString("ko-KR")} / ${coupon.issued_count.toLocaleString("ko-KR")}건`,
  },
];

export function CouponsPage() {
  const navigate = useNavigate();
  const { query: parsed, replaceQuery } = useAdminListUrlState({
    allowedSorts: COUPON_SORTS,
    allowedStatuses: COUPON_STATUSES,
    defaultSort: "created_at",
  });
  const [search, setSearch] = useState<string>();
  const [searchResetKey, setSearchResetKey] = useState(0);
  const status = (parsed.status ?? "all") as CouponStatus;
  const [draftStatus, setDraftStatus] = useState<CouponStatus>(status);
  const [draftFrom, setDraftFrom] = useState(parsed.from);
  const [draftTo, setDraftTo] = useState(parsed.to);
  const sort = (parsed.sort ?? "created_at") as CouponSort;
  const query = useQuery({
    ...listAdminCouponsOptions({
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
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title="쿠폰 관리"
          description="쿠폰 정의와 발급 현황을 조회합니다. 목록 상태에는 비민감 필터만 저장합니다."
        />
        <ActionButton onClick={() => navigate("/coupons/new")}>
          새 쿠폰 등록
        </ActionButton>
      </HStack>

      <PaginatedAdminTableCard
        title="쿠폰 목록"
        label="쿠폰 목록"
        columns={columns}
        rows={query.data?.items}
        getRowKey={(coupon) => coupon.id}
        onRowClick={(coupon) => navigate(`/coupons/${coupon.id}`)}
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
        emptyTitle="조건에 맞는 쿠폰이 없습니다"
        emptyDescription="필터를 바꾸거나 새 쿠폰을 등록해 주세요."
        page={Math.min(parsed.page, totalPages)}
        totalPages={totalPages}
        onPageChange={(page) => replaceQuery({ page })}
        paginationLabel="쿠폰 목록 페이지"
        toolbar={
          <VStack gap="x3" alignItems="stretch">
            <CompactFilterToolbar
              primaryControls={
                <SubmittedMemorySearch
                  label="쿠폰명·표시명·쿠폰 ID 검색"
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
                    label="활성 상태"
                    presentation="inline"
                    value={draftStatus}
                    options={[
                      { value: "all", label: "전체" },
                      { value: "active", label: "활성" },
                      { value: "inactive", label: "비활성" },
                    ]}
                    onValueChange={(value) =>
                      setDraftStatus(value as CouponStatus)
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
              secondaryTitle="쿠폰 필터"
              secondaryDescription="활성 상태와 등록일을 한 번에 적용합니다."
              onOpenSecondaryFilters={() => {
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
              onCancelSecondaryFilters={() => {
                setDraftStatus(status);
                setDraftFrom(parsed.from);
                setDraftTo(parsed.to);
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
                  label: `상태: ${status === "active" ? "활성" : "비활성"}`,
                  onRemove: () => replaceQuery({ status: undefined, page: 1 }),
                },
                parsed.from !== undefined && {
                  key: "from",
                  label: `등록 시작일: ${parsed.from}`,
                  onRemove: () => replaceQuery({ from: undefined, page: 1 }),
                },
                parsed.to !== undefined && {
                  key: "to",
                  label: `등록 종료일: ${parsed.to}`,
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

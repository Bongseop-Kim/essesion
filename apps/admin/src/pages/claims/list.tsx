import type { AdminClaimSummaryOut } from "@essesion/api-client";
import { adminListClaimsV2Options } from "@essesion/api-client/query";
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

const CLAIM_TYPES = [
  { value: "all", label: "전체" },
  { value: "cancel", label: "취소" },
  { value: "return", label: "반품" },
  { value: "exchange", label: "교환" },
  { value: "token_refund", label: "토큰 환불" },
] as const;

const CLAIM_STATUSES = [
  "all",
  "접수",
  "처리중",
  "수거요청",
  "수거완료",
  "재발송",
  "완료",
  "거부",
] as const;

const CLAIM_SORTS = [
  "created_at",
  "updated_at",
  "claim_number",
  "status",
] as const;

type ClaimType = (typeof CLAIM_TYPES)[number]["value"];
type ClaimStatus = (typeof CLAIM_STATUSES)[number];
type ClaimSort = (typeof CLAIM_SORTS)[number];

function claimTypeLabel(type: string) {
  return CLAIM_TYPES.find((item) => item.value === type)?.label ?? type;
}

const columns: readonly AdminTableColumn<AdminClaimSummaryOut>[] = [
  {
    key: "claim_number",
    header: "클레임번호",
    sortable: true,
    render: (claim) => (
      <Link to={`/claims/${claim.id}`}>{claim.claim_number}</Link>
    ),
  },
  {
    key: "customer",
    header: "고객",
    render: (claim) => (
      <VStack gap="x0_5">
        <Text textStyle="bodySm">{claim.customer.name}</Text>
        <Text textStyle="caption" color="fg.neutral-muted">
          {claim.customer.email ?? "이메일 없음"}
        </Text>
      </VStack>
    ),
  },
  {
    key: "type",
    header: "유형",
    visibility: "medium",
    render: (claim) => claimTypeLabel(claim.type),
  },
  {
    key: "order",
    header: "주문",
    visibility: "medium",
    render: (claim) => (
      <Link to={`/orders/${claim.order_id}`}>{claim.order_number}</Link>
    ),
  },
  {
    key: "status",
    header: "상태",
    sortable: true,
    render: (claim) => <StatusBadge status={claim.status} />,
  },
  {
    key: "created_at",
    header: "접수일",
    sortable: true,
    visibility: "large",
    render: (claim) => formatDateTime(claim.created_at),
  },
];

export function ClaimsPage() {
  const navigate = useNavigate();
  const { query: parsed, replaceQuery } = useAdminListUrlState({
    allowedSorts: CLAIM_SORTS,
    allowedStatuses: CLAIM_STATUSES,
    allowedTypes: CLAIM_TYPES.map((item) => item.value),
    defaultSort: "created_at",
    defaultDirection: "desc",
  });
  const [search, setSearch] = useState<string>();
  const [searchResetKey, setSearchResetKey] = useState(0);
  const claimType = (parsed.type ?? "all") as ClaimType;
  const status = (parsed.status ?? "all") as ClaimStatus;
  const sort = (parsed.sort ?? "created_at") as ClaimSort;
  const [draftStatus, setDraftStatus] = useState<ClaimStatus>(status);
  const [draftClaimType, setDraftClaimType] = useState<ClaimType>(claimType);
  const [draftFrom, setDraftFrom] = useState(parsed.from);
  const [draftTo, setDraftTo] = useState(parsed.to);

  const query = useQuery({
    ...adminListClaimsV2Options({
      query: {
        claim_type: claimType,
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
        title="클레임 관리"
        description="취소·반품·교환·토큰 환불 요청과 처리 상태를 조회합니다."
      />

      <PaginatedAdminTableCard
        title="클레임 목록"
        label="클레임 목록"
        columns={columns}
        rows={query.data?.items}
        getRowKey={(row) => row.id}
        onRowClick={(row) => navigate(`/claims/${row.id}`)}
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
        emptyTitle="조건에 맞는 클레임이 없습니다"
        page={Math.min(parsed.page, totalPages)}
        totalPages={totalPages}
        onPageChange={(page) => replaceQuery({ page })}
        paginationLabel="클레임 목록 페이지"
        toolbar={
          <VStack gap="x3" alignItems="stretch">
            <CompactFilterToolbar
              primaryControls={
                <SubmittedMemorySearch
                  label="클레임번호 검색"
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
                    options={CLAIM_STATUSES.map((value) => ({
                      value,
                      label: value === "all" ? "전체" : value,
                    }))}
                    onValueChange={(value) =>
                      setDraftStatus(value as ClaimStatus)
                    }
                  />
                  <FilterSelect
                    label="클레임 유형"
                    presentation="inline"
                    value={draftClaimType}
                    options={CLAIM_TYPES}
                    onValueChange={(value) =>
                      setDraftClaimType(value as ClaimType)
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
                Number(claimType !== "all") +
                Number(parsed.from !== undefined) +
                Number(parsed.to !== undefined)
              }
              onOpenSecondaryFilters={() => {
                setDraftStatus(status);
                setDraftClaimType(claimType);
                setDraftFrom(parsed.from);
                setDraftTo(parsed.to);
              }}
              onCancelSecondaryFilters={() => {
                setDraftStatus(status);
                setDraftClaimType(claimType);
                setDraftFrom(parsed.from);
                setDraftTo(parsed.to);
              }}
              onApplySecondaryFilters={() => {
                replaceQuery({
                  status: draftStatus === "all" ? undefined : draftStatus,
                  type: draftClaimType === "all" ? undefined : draftClaimType,
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
                claimType !== "all" && {
                  key: "type",
                  label: `유형: ${claimTypeLabel(claimType)}`,
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

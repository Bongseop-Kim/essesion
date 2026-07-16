import type { PaymentIncidentSummaryOut } from "@essesion/api-client";
import { adminListPaymentIncidentsOptions } from "@essesion/api-client/query";
import { Text, VStack } from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { formatDateTime, formatMoney } from "../../shared/lib/format";
import { activeAdminPollingInterval } from "../../shared/lib/polling";
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

const INCIDENT_TYPES = [
  { value: "all", label: "전체" },
  { value: "confirm", label: "결제 승인" },
  { value: "refund", label: "환불" },
  { value: "partial_cancel", label: "부분 취소" },
  { value: "mixed_state", label: "상태 불일치" },
  { value: "amount_mismatch", label: "금액 불일치" },
] as const;

const INCIDENT_STATUSES = ["all", "open", "resolved"] as const;
const INCIDENT_SORTS = [
  "created_at",
  "updated_at",
  "status",
  "incident_type",
] as const;

type IncidentType = (typeof INCIDENT_TYPES)[number]["value"];
type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
type IncidentSort = (typeof INCIDENT_SORTS)[number];

function incidentTypeLabel(type: string) {
  return INCIDENT_TYPES.find((item) => item.value === type)?.label ?? type;
}

const columns: readonly AdminTableColumn<PaymentIncidentSummaryOut>[] = [
  {
    key: "incident_type",
    header: "유형",
    sortable: true,
    render: (incident) => (
      <Link to={`/incidents/${incident.id}`}>
        {incidentTypeLabel(incident.incident_type)}
      </Link>
    ),
  },
  {
    key: "status",
    header: "상태",
    sortable: true,
    render: (incident) => <StatusBadge status={incident.status} />,
  },
  {
    key: "related",
    header: "관련 리소스",
    render: (incident) => (
      <VStack gap="x0_5">
        {incident.order_id !== null ? (
          <Link to={`/orders/${incident.order_id}`}>주문 보기</Link>
        ) : (
          <Text textStyle="caption" color="fg.neutral-muted">
            연결 주문 없음
          </Text>
        )}
        {incident.claim_id !== null && (
          <Link to={`/claims/${incident.claim_id}`}>클레임 보기</Link>
        )}
      </VStack>
    ),
  },
  {
    key: "amount",
    header: "기대 / 확인 금액",
    align: "end",
    visibility: "medium",
    render: (incident) =>
      `${formatMoney(incident.expected_amount)} / ${formatMoney(incident.observed_amount)}`,
  },
  {
    key: "created_at",
    header: "발생일",
    sortable: true,
    visibility: "large",
    render: (incident) => formatDateTime(incident.created_at),
  },
];

export function IncidentsPage() {
  const navigate = useNavigate();
  const { query: parsed, replaceQuery } = useAdminListUrlState({
    allowedSorts: INCIDENT_SORTS,
    allowedStatuses: INCIDENT_STATUSES,
    allowedTypes: INCIDENT_TYPES.map((item) => item.value),
    defaultSort: "created_at",
    defaultDirection: "desc",
  });
  const incidentType = (parsed.type ?? "all") as IncidentType;
  const status = (parsed.status ?? "open") as IncidentStatus;
  const sort = (parsed.sort ?? "created_at") as IncidentSort;
  const [search, setSearch] = useState<string>();
  const [searchResetKey, setSearchResetKey] = useState(0);
  const [draftStatus, setDraftStatus] = useState<IncidentStatus>(status);
  const [draftIncidentType, setDraftIncidentType] =
    useState<IncidentType>(incidentType);
  const [draftFrom, setDraftFrom] = useState(parsed.from);
  const [draftTo, setDraftTo] = useState(parsed.to);

  const query = useQuery({
    ...adminListPaymentIncidentsOptions({
      query: {
        q: search,
        incident_type: incidentType,
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
    refetchInterval: (query) =>
      activeAdminPollingInterval(
        query.state.data?.items?.some((item) => item.status === "open") ??
          false,
      ),
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
        title="결제 이상"
        description="결제·취소의 불확실한 상태를 조회하고 안전하게 대사합니다."
      />

      <PaginatedAdminTableCard
        title="결제 이상 목록"
        description="미해결 목록은 30초마다 갱신"
        label="결제 이상 목록"
        columns={columns}
        rows={query.data?.items}
        getRowKey={(row) => row.id}
        onRowClick={(row) => navigate(`/incidents/${row.id}`)}
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
        emptyTitle="조건에 맞는 결제 이상이 없습니다"
        page={Math.min(parsed.page, totalPages)}
        totalPages={totalPages}
        onPageChange={(page) => replaceQuery({ page })}
        paginationLabel="결제 이상 목록 페이지"
        toolbar={
          <VStack gap="x3" alignItems="stretch">
            <CompactFilterToolbar
              primaryControls={
                <SubmittedMemorySearch
                  label="결제 이상·요청 ID 검색"
                  placeholder="2자 이상 입력"
                  maxLength={128}
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
                    options={[
                      { value: "all", label: "전체" },
                      { value: "open", label: "미해결" },
                      { value: "resolved", label: "해결" },
                    ]}
                    onValueChange={(value) =>
                      setDraftStatus(value as IncidentStatus)
                    }
                  />
                  <FilterSelect
                    label="이상 유형"
                    presentation="inline"
                    value={draftIncidentType}
                    options={INCIDENT_TYPES}
                    onValueChange={(value) =>
                      setDraftIncidentType(value as IncidentType)
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
                Number(status !== "open") +
                Number(incidentType !== "all") +
                Number(parsed.from !== undefined) +
                Number(parsed.to !== undefined)
              }
              secondaryTitle="결제 이상 필터"
              secondaryDescription="상태, 이상 유형, 조회 기간을 한 번에 적용합니다."
              onOpenSecondaryFilters={() => {
                setDraftStatus(status);
                setDraftIncidentType(incidentType);
                setDraftFrom(parsed.from);
                setDraftTo(parsed.to);
              }}
              onCancelSecondaryFilters={() => {
                setDraftStatus(status);
                setDraftIncidentType(incidentType);
                setDraftFrom(parsed.from);
                setDraftTo(parsed.to);
              }}
              onApplySecondaryFilters={() => {
                replaceQuery({
                  status: draftStatus === "open" ? undefined : draftStatus,
                  type: draftIncidentType,
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
                incidentType !== "all" && {
                  key: "type",
                  label: `유형: ${incidentTypeLabel(incidentType)}`,
                  onRemove: () => replaceQuery({ type: undefined, page: 1 }),
                },
                status !== "open" && {
                  key: "status",
                  label: `상태: ${status === "all" ? "전체" : "해결"}`,
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

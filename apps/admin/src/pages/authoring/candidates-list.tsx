import type { AuthoringCandidateSummaryOut } from "@essesion/api-client";
import { listAuthoringCandidatesOptions } from "@essesion/api-client/query";
import { Text, VStack } from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";

import { formatDateTime } from "../../shared/lib/format";
import {
  useAdminListPageCorrection,
  useAdminListUrlState,
} from "../../shared/lib/use-admin-list-url-state";
import { AppliedFilterBar } from "../../shared/ui/applied-filter-bar";
import { CompactFilterToolbar } from "../../shared/ui/compact-filter-toolbar";
import { FilterSelect } from "../../shared/ui/filter-select";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";
import { SubmittedMemorySearch } from "../../shared/ui/submitted-memory-search";
import type { AdminTableColumn } from "../../widgets/admin-table/admin-table";
import { PaginatedAdminTableCard } from "../../widgets/admin-table/paginated-admin-table-card";

/** 검토 대기가 기본 화면이므로 URL에 status가 없으면 pending으로 본다. */
const DEFAULT_STATUS = "pending";
const CANDIDATE_STATUS_LABELS = {
  pending: "검토 대기",
  hold: "보류",
  approved: "승인",
  rejected: "거절",
  duplicate: "자동 중복",
  invalid: "자동 제외",
  all: "전체",
} as const;
const CANDIDATE_STATUSES = Object.keys(
  CANDIDATE_STATUS_LABELS,
) as readonly CandidateStatus[];

type CandidateStatus = keyof typeof CANDIDATE_STATUS_LABELS;

const columns: readonly AdminTableColumn<AuthoringCandidateSummaryOut>[] = [
  {
    key: "created_at",
    header: "등록",
    render: (row) => formatDateTime(row.created_at),
  },
  {
    key: "prompt",
    header: "사용자 요청",
    render: (row) => (
      <VStack gap="x0_5" alignItems="stretch">
        <Text textStyle="bodySm" className="line-clamp-2">
          {row.retrieval_text}
        </Text>
        <Text textStyle="caption" color="fg.neutral-muted">
          {row.selected_candidate_id}
        </Text>
      </VStack>
    ),
  },
  {
    key: "structure",
    header: "구조",
    visibility: "medium",
    render: (row) => `${row.family} · motif ${row.motif_count}`,
  },
  {
    key: "nearest",
    header: "최근접",
    visibility: "large",
    render: (row) =>
      row.nearest_similarity === null
        ? "-"
        : `${row.nearest_kind ?? "unknown"} · ${row.nearest_similarity.toFixed(3)}`,
  },
  {
    key: "status",
    header: "상태",
    render: (row) => <StatusBadge status={row.status} />,
  },
];

export function FewShotCandidatesPage() {
  const navigate = useNavigate();
  const { query: parsed, replaceQuery } = useAdminListUrlState({
    allowedStatuses: CANDIDATE_STATUSES,
  });
  const status = (parsed.status ?? DEFAULT_STATUS) as CandidateStatus;
  const [draftStatus, setDraftStatus] = useState(status);
  const [search, setSearch] = useState<string>();
  const [searchResetKey, setSearchResetKey] = useState(0);
  const query = useQuery({
    ...listAuthoringCandidatesOptions({
      query: {
        status,
        q: search,
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
        title="few-shot 후보"
        description="생성 결과 중 few-shot 시범으로 선별할 후보를 검토합니다. 선택 후 성공적으로 실사화된 Plan v3 결과만 등록됩니다."
      />

      <PaginatedAdminTableCard
        title="선별 검토 대상"
        label="few-shot 후보"
        columns={columns}
        rows={query.data?.items}
        getRowKey={(row) => row.id}
        onRowClick={(row) => navigate(`/few-shot-candidates/${row.id}`)}
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
        onRetry={() => void query.refetch()}
        emptyTitle="조건에 맞는 few-shot 후보가 없습니다"
        page={Math.min(parsed.page, totalPages)}
        totalPages={totalPages}
        onPageChange={(page) => replaceQuery({ page })}
        paginationLabel="few-shot 후보 페이지"
        toolbar={
          <VStack gap="x3" alignItems="stretch">
            <CompactFilterToolbar
              primaryControls={
                <SubmittedMemorySearch
                  label="요청 또는 식별자 검색"
                  placeholder="2자 이상 입력"
                  maxLength={200}
                  resetKey={searchResetKey}
                  onSubmit={(value) => {
                    setSearch(value);
                    replaceQuery({ page: 1 });
                  }}
                />
              }
              secondaryFilters={
                <FilterSelect
                  label="검토 상태"
                  presentation="inline"
                  value={draftStatus}
                  options={CANDIDATE_STATUSES.map((value) => ({
                    value,
                    label: CANDIDATE_STATUS_LABELS[value],
                  }))}
                  onValueChange={(value) =>
                    setDraftStatus(value as CandidateStatus)
                  }
                />
              }
              secondaryFilterCount={Number(parsed.status !== undefined)}
              secondaryTitle="few-shot 후보 필터"
              secondaryDescription="검토 상태를 골라 한 번에 적용합니다."
              onOpenSecondaryFilters={() => setDraftStatus(status)}
              onCancelSecondaryFilters={() => setDraftStatus(status)}
              onApplySecondaryFilters={() => {
                replaceQuery({
                  status:
                    draftStatus === DEFAULT_STATUS ? undefined : draftStatus,
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
                parsed.status !== undefined && {
                  key: "status",
                  label: `검토 상태: ${CANDIDATE_STATUS_LABELS[status]}`,
                  onRemove: () => replaceQuery({ status: undefined, page: 1 }),
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

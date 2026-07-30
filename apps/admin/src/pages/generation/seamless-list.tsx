import type {
  SeamlessStatsOut,
  SeamlessSummaryOut,
} from "@essesion/api-client";
import {
  getAdminSeamlessStatsOptions,
  listAdminSeamlessLogsOptions,
} from "@essesion/api-client/query";
import { ActionButton, ContentPlaceholder, VStack } from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { formatDateTime } from "../../shared/lib/format";
import { activeAdminPollingInterval } from "../../shared/lib/polling";
import {
  useAdminListPageCorrection,
  useAdminListUrlState,
} from "../../shared/lib/use-admin-list-url-state";
import { AdminCard } from "../../shared/ui/admin-card";
import { AppliedFilterBar } from "../../shared/ui/applied-filter-bar";
import { CompactFilterToolbar } from "../../shared/ui/compact-filter-toolbar";
import { FilterSelect } from "../../shared/ui/filter-select";
import { RouteHeading } from "../../shared/ui/route-heading";
import { SubmittedMemorySearch } from "../../shared/ui/submitted-memory-search";
import type { AdminTableColumn } from "../../widgets/admin-table/admin-table";
import { PaginatedAdminTableCard } from "../../widgets/admin-table/paginated-admin-table-card";
import { FAILURE_STAGE_LABELS, inputTypeLabel } from "./generation-labels";
import {
  formatMilliseconds,
  IdentifierLink,
  isOneOf,
  MetricGrid,
  OperationalStatusBadge,
  operationalStatusLabel,
  PeriodFilters,
  periodBoundary,
  RefreshStatus,
} from "./shared";

const SEAMLESS_STATUSES = ["success", "partial", "error"] as const;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

type SeamlessStatus = (typeof SEAMLESS_STATUSES)[number];

function SeamlessStatistics({
  data,
  loading,
}: {
  data: SeamlessStatsOut | undefined;
  loading: boolean;
}) {
  return (
    <MetricGrid
      loading={loading}
      items={[
        { label: "전체", value: `${data?.total ?? 0}건` },
        { label: "성공", value: `${data?.success ?? 0}건` },
        { label: "부분 성공", value: `${data?.partial ?? 0}건` },
        { label: "오류", value: `${data?.error ?? 0}건` },
        {
          label: "평균 생성",
          value: formatMilliseconds(data?.average_generate_ms),
        },
        {
          label: "평균 렌더",
          value: formatMilliseconds(data?.average_render_ms),
        },
      ]}
    />
  );
}

export function SeamlessLogsPage() {
  const navigate = useNavigate();
  const { query: parsed, replaceQuery } = useAdminListUrlState({
    allowedStatuses: SEAMLESS_STATUSES,
  });
  const status = isOneOf(parsed.status, SEAMLESS_STATUSES)
    ? parsed.status
    : undefined;
  const [autoRefreshPaused, setAutoRefreshPaused] = useState(false);
  const [draftStatus, setDraftStatus] = useState<SeamlessStatus | undefined>(
    status,
  );
  const [identifier, setIdentifier] = useState<string>();
  const [identifierSearchResetKey, setIdentifierSearchResetKey] = useState(0);
  const [draftFrom, setDraftFrom] = useState<string | undefined>(parsed.from);
  const [draftTo, setDraftTo] = useState<string | undefined>(parsed.to);
  const [lastSuccessfulRefreshAt, setLastSuccessfulRefreshAt] = useState(0);
  const commonQuery = {
    status,
    identifier,
    start: periodBoundary(parsed.from, false),
    end: periodBoundary(parsed.to, true),
  };
  const listQuery = useQuery({
    ...listAdminSeamlessLogsOptions({
      query: {
        ...commonQuery,
        limit: parsed.limit,
        offset: (parsed.page - 1) * parsed.limit,
      },
    }),
    placeholderData: keepPreviousData,
    refetchInterval: () =>
      autoRefreshPaused ? false : activeAdminPollingInterval(true),
  });
  const statsQuery = useQuery({
    ...getAdminSeamlessStatsOptions({ query: commonQuery }),
    refetchInterval: () =>
      autoRefreshPaused ? false : activeAdminPollingInterval(true),
  });

  useEffect(() => {
    if (
      listQuery.fetchStatus === "idle" &&
      statsQuery.fetchStatus === "idle" &&
      listQuery.isSuccess &&
      statsQuery.isSuccess
    ) {
      setLastSuccessfulRefreshAt(Date.now());
    }
  }, [
    listQuery.fetchStatus,
    listQuery.isSuccess,
    statsQuery.fetchStatus,
    statsQuery.isSuccess,
  ]);

  const toggleAutoRefresh = () => {
    if (autoRefreshPaused) {
      setAutoRefreshPaused(false);
      void Promise.all([listQuery.refetch(), statsQuery.refetch()]);
      return;
    }
    setAutoRefreshPaused(true);
  };

  const columns: readonly AdminTableColumn<SeamlessSummaryOut>[] = [
    {
      key: "id",
      header: "로그 ID",
      render: (log) => (
        <IdentifierLink
          value={log.id}
          href={`/seamless-logs/${log.id}`}
          label="로그 ID"
        />
      ),
    },
    {
      key: "request_id",
      header: "요청 ID",
      render: (log) => log.request_id ?? "-",
    },
    {
      key: "input_type",
      header: "입력",
      visibility: "large",
      render: (log) => inputTypeLabel(log.input_type),
    },
    {
      key: "status",
      header: "상태",
      render: (log) => <OperationalStatusBadge status={log.status} />,
    },
    {
      key: "candidates",
      header: "후보",
      align: "end",
      render: (log) =>
        `${log.candidate_count_returned ?? 0} / ${log.candidate_count_requested ?? "-"}`,
    },
    {
      key: "warning_count",
      header: "경고",
      align: "end",
      visibility: "medium",
      render: (log) => `${log.warning_count}건`,
    },
    {
      key: "duration",
      header: "생성 / 렌더",
      align: "end",
      visibility: "large",
      render: (log) =>
        `${formatMilliseconds(log.generate_ms)} / ${formatMilliseconds(log.render_ms)}`,
    },
    {
      key: "created_at",
      header: "생성일",
      visibility: "large",
      render: (log) => formatDateTime(log.created_at),
    },
    {
      key: "error",
      header: "오류",
      visibility: "large",
      render: (log) =>
        log.error_summary
          ? `${log.error_summary}${
              log.failure_stage
                ? ` (${FAILURE_STAGE_LABELS[log.failure_stage] ?? log.failure_stage})`
                : ""
            }`
          : "-",
    },
  ];
  const totalPages = Math.max(
    1,
    Math.ceil((listQuery.data?.total ?? 0) / parsed.limit),
  );
  useAdminListPageCorrection({
    page: parsed.page,
    limit: parsed.limit,
    total: listQuery.data?.total,
    ready: listQuery.isSuccess && !listQuery.isPlaceholderData,
    replaceQuery,
  });

  const toolbar = (
    <VStack gap="x3" alignItems="stretch">
      <CompactFilterToolbar
        primaryControls={
          <SubmittedMemorySearch
            label="식별자 검색"
            placeholder="로그·요청·세션·사용자 ID"
            maxLength={128}
            resetKey={identifierSearchResetKey}
            validate={(value) =>
              SAFE_IDENTIFIER_PATTERN.test(value)
                ? undefined
                : "식별자 형식이 올바르지 않습니다."
            }
            onSubmit={(value) => {
              setIdentifier(value);
              replaceQuery({ page: 1 });
            }}
          />
        }
        secondaryFilters={
          <VStack gap="x4" alignItems="stretch">
            <FilterSelect
              label="상태"
              presentation="inline"
              value={draftStatus ?? "all"}
              options={[
                { value: "all", label: "전체" },
                ...SEAMLESS_STATUSES.map((value) => ({
                  value,
                  label: operationalStatusLabel(value),
                })),
              ]}
              onValueChange={(value) =>
                setDraftStatus(
                  value === "all" ? undefined : (value as SeamlessStatus),
                )
              }
            />
            <PeriodFilters
              from={draftFrom}
              to={draftTo}
              onFromChange={setDraftFrom}
              onToChange={setDraftTo}
            />
          </VStack>
        }
        secondaryFilterCount={
          Number(status !== undefined) +
          Number(parsed.from !== undefined || parsed.to !== undefined)
        }
        secondaryTitle="Seamless 상세 필터"
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
            status: draftStatus,
            from: draftFrom,
            to: draftTo,
            page: 1,
          });
        }}
      />
      <AppliedFilterBar
        filters={[
          status !== undefined && {
            key: "status",
            label: `상태: ${operationalStatusLabel(status)}`,
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
          identifier !== undefined && {
            key: "identifier",
            label: `식별자: ${identifier}`,
            onRemove: () => {
              setIdentifier(undefined);
              setIdentifierSearchResetKey((key) => key + 1);
              replaceQuery({ page: 1 });
            },
          },
        ]}
        onReset={() => {
          setIdentifier(undefined);
          setIdentifierSearchResetKey((key) => key + 1);
          replaceQuery({
            page: 1,
            limit: 20,
            sort: undefined,
            direction: "asc",
            status: undefined,
            from: undefined,
            to: undefined,
          });
        }}
      />
    </VStack>
  );

  return (
    <VStack gap="x6" alignItems="stretch">
      <RouteHeading
        title="Seamless 로그"
        description="Seamless 생성 요청의 상태·지연·정제된 오류를 조회합니다."
      />

      <AdminCard title="Seamless 통계" description="현재 필터 기준 집계입니다.">
        {statsQuery.isError ? (
          <ContentPlaceholder
            title="Seamless 통계를 불러오지 못했습니다"
            description="목록과 별도로 통계 조회를 다시 시도할 수 있습니다."
            action={
              <ActionButton
                variant="neutralOutline"
                onClick={() => void statsQuery.refetch()}
              >
                통계 다시 시도
              </ActionButton>
            }
          />
        ) : (
          <SeamlessStatistics
            data={statsQuery.data}
            loading={statsQuery.isLoading}
          />
        )}
      </AdminCard>

      <RefreshStatus
        label="Seamless 로그"
        lastUpdatedAt={lastSuccessfulRefreshAt}
        paused={autoRefreshPaused}
        description="화면이 보일 때 새 로그를 30초마다 갱신합니다."
        onToggle={toggleAutoRefresh}
      />

      <PaginatedAdminTableCard
        title="Seamless 로그 목록"
        label="Seamless 로그 목록"
        columns={columns}
        rows={listQuery.data?.items}
        getRowKey={(row) => row.id}
        onRowClick={(row) => navigate(`/seamless-logs/${row.id}`)}
        status={
          listQuery.isLoading || listQuery.isPlaceholderData
            ? "loading"
            : listQuery.isError
              ? "error"
              : "success"
        }
        total={listQuery.data?.total}
        limit={parsed.limit}
        refreshing={listQuery.isFetching || statsQuery.isFetching}
        onRefresh={() =>
          void Promise.all([listQuery.refetch(), statsQuery.refetch()])
        }
        onRetry={() => void listQuery.refetch()}
        emptyTitle="조건에 맞는 Seamless 로그가 없습니다"
        page={Math.min(parsed.page, totalPages)}
        totalPages={totalPages}
        onPageChange={(page) => replaceQuery({ page })}
        paginationLabel="Seamless 로그 목록 페이지"
        toolbar={toolbar}
      />
    </VStack>
  );
}

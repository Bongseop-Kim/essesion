import type {
  GenerationJobStatsOut,
  GenerationJobSummaryOut,
} from "@essesion/api-client";
import {
  getAdminGenerationJobStatsOptions,
  listAdminGenerationJobsOptions,
} from "@essesion/api-client/query";
import {
  ActionButton,
  ContentPlaceholder,
  HStack,
  TextField,
  VStack,
} from "@essesion/shared";
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
import {
  JOB_KINDS,
  JOB_STATUS_LABELS,
  JOB_STATUSES,
  jobKindLabel,
} from "./job-status";
import {
  formatDuration,
  IdentifierLink,
  isOneOf,
  MetricGrid,
  OperationalStatusBadge,
  operationalStatusLabel,
  PeriodFilters,
  periodBoundary,
  RefreshStatus,
  UUID_PATTERN,
} from "./shared";

type JobStatus = (typeof JOB_STATUSES)[number];
type JobKind = (typeof JOB_KINDS)[number];

function JobStatistics({
  data,
  loading,
}: {
  data: GenerationJobStatsOut | undefined;
  loading: boolean;
}) {
  return (
    <MetricGrid
      loading={loading}
      items={[
        { label: "전체", value: `${data?.total ?? 0}건` },
        { label: "대기", value: `${data?.queued ?? 0}건` },
        { label: "처리 중", value: `${data?.processing ?? 0}건` },
        { label: "성공", value: `${data?.succeeded ?? 0}건` },
        { label: "실패", value: `${data?.failed ?? 0}건` },
        { label: "취소", value: `${data?.canceled ?? 0}건` },
        {
          label: "평균 시도",
          value: `${(data?.average_attempts ?? 0).toFixed(1)}회`,
        },
      ]}
    />
  );
}

export function GenerationJobsPage() {
  const navigate = useNavigate();
  const { query: parsed, replaceQuery } = useAdminListUrlState({
    allowedStatuses: JOB_STATUSES,
    allowedTypes: JOB_KINDS,
  });
  const status = isOneOf(parsed.status, JOB_STATUSES)
    ? parsed.status
    : undefined;
  const kind = isOneOf(parsed.type, JOB_KINDS) ? parsed.type : undefined;
  const [autoRefreshPaused, setAutoRefreshPaused] = useState(false);
  const [jobId, setJobId] = useState<string>();
  const [jobSearchResetKey, setJobSearchResetKey] = useState(0);
  const [draftStatus, setDraftStatus] = useState<JobStatus | undefined>(status);
  const [userInput, setUserInput] = useState("");
  const [userId, setUserId] = useState<string>();
  const [userError, setUserError] = useState<string>();
  const [draftKind, setDraftKind] = useState<JobKind | undefined>(kind);
  const [draftFrom, setDraftFrom] = useState<string | undefined>(parsed.from);
  const [draftTo, setDraftTo] = useState<string | undefined>(parsed.to);
  const [lastSuccessfulRefreshAt, setLastSuccessfulRefreshAt] = useState(0);
  const commonQuery = {
    job_id: jobId,
    kind,
    status,
    user_id: userId,
    start: periodBoundary(parsed.from, false),
    end: periodBoundary(parsed.to, true),
  };
  const listQuery = useQuery({
    ...listAdminGenerationJobsOptions({
      query: {
        ...commonQuery,
        limit: parsed.limit,
        offset: (parsed.page - 1) * parsed.limit,
      },
    }),
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      autoRefreshPaused
        ? false
        : activeAdminPollingInterval(
            query.state.data?.items?.some((item) =>
              ["queued", "processing"].includes(item.status),
            ) ?? false,
          ),
  });
  const statsQuery = useQuery({
    ...getAdminGenerationJobStatsOptions({ query: commonQuery }),
    refetchInterval: (query) =>
      autoRefreshPaused
        ? false
        : activeAdminPollingInterval(
            (query.state.data?.queued ?? 0) +
              (query.state.data?.processing ?? 0) >
              0,
          ),
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

  const applyUserInput = () => {
    const value = userInput.trim();
    if (value === "") {
      setUserError(undefined);
      setUserId(undefined);
      return true;
    }
    if (!UUID_PATTERN.test(value)) {
      setUserError("사용자 ID는 UUID 형식이어야 합니다.");
      return false;
    }
    setUserError(undefined);
    setUserId(value);
    return true;
  };

  const columns: readonly AdminTableColumn<GenerationJobSummaryOut>[] = [
    {
      key: "id",
      header: "작업 ID",
      render: (job) => (
        <IdentifierLink
          value={job.id}
          href={`/generation-jobs/${job.id}`}
          label="작업 ID"
        />
      ),
    },
    {
      key: "status",
      header: "상태",
      render: (job) => <OperationalStatusBadge status={job.status} />,
    },
    {
      key: "kind",
      header: "단계",
      render: (job) => jobKindLabel(job.kind),
    },
    {
      key: "attempts",
      header: "시도",
      align: "end",
      render: (job) => `${job.attempts.toLocaleString("ko-KR")}회`,
    },
    {
      key: "duration",
      header: "처리 시간",
      align: "end",
      visibility: "medium",
      render: (job) => formatDuration(job.created_at, job.updated_at),
    },
    {
      key: "created_at",
      header: "생성일",
      visibility: "large",
      render: (job) => formatDateTime(job.created_at),
    },
    {
      key: "error",
      header: "오류",
      visibility: "large",
      render: (job) => job.error_summary ?? "-",
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
            label="작업 ID 검색"
            placeholder="정확한 작업 ID 입력"
            maxLength={36}
            resetKey={jobSearchResetKey}
            validate={(value) =>
              UUID_PATTERN.test(value)
                ? undefined
                : "작업 ID는 UUID 형식이어야 합니다."
            }
            onSubmit={(value) => {
              setJobId(value);
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
                ...JOB_STATUSES.map((status) => ({
                  value: status,
                  label: JOB_STATUS_LABELS[status],
                })),
              ]}
              onValueChange={(value) =>
                setDraftStatus(
                  value === "all" ? undefined : (value as JobStatus),
                )
              }
            />
            <FilterSelect
              label="작업 단계"
              presentation="inline"
              value={draftKind ?? "all"}
              options={[
                { value: "all", label: "전체" },
                ...JOB_KINDS.map((kind) => ({
                  value: kind,
                  label: jobKindLabel(kind),
                })),
              ]}
              onValueChange={(value) =>
                setDraftKind(value === "all" ? undefined : (value as JobKind))
              }
            />
            <TextField
              label="사용자 ID"
              placeholder="정확한 사용자 ID 입력"
              errorMessage={userError}
              value={userInput}
              onChange={(event) => {
                setUserInput(event.currentTarget.value);
                setUserError(undefined);
              }}
            />
            <HStack gap="x3" align="flex-end" wrap>
              <PeriodFilters
                from={draftFrom}
                to={draftTo}
                onFromChange={setDraftFrom}
                onToChange={setDraftTo}
              />
            </HStack>
          </VStack>
        }
        secondaryFilterCount={
          Number(status !== undefined) +
          Number(kind !== undefined) +
          Number(userId !== undefined) +
          Number(parsed.from !== undefined || parsed.to !== undefined)
        }
        secondaryTitle="생성 작업 필터"
        secondaryDescription="상태, 작업 단계, 사용자 ID, 조회 기간을 한 번에 적용합니다."
        onOpenSecondaryFilters={() => {
          setDraftStatus(status);
          setDraftKind(kind);
          setUserInput(userId ?? "");
          setUserError(undefined);
          setDraftFrom(parsed.from);
          setDraftTo(parsed.to);
        }}
        onCancelSecondaryFilters={() => {
          setDraftStatus(status);
          setDraftKind(kind);
          setUserInput(userId ?? "");
          setUserError(undefined);
          setDraftFrom(parsed.from);
          setDraftTo(parsed.to);
        }}
        onApplySecondaryFilters={() => {
          if (!applyUserInput()) return false;
          replaceQuery({
            status: draftStatus,
            type: draftKind,
            from: draftFrom,
            to: draftTo,
            page: 1,
          });
        }}
      />
      <AppliedFilterBar
        filters={[
          jobId !== undefined && {
            key: "job",
            label: `작업 ID: ${jobId}`,
            onRemove: () => {
              setJobId(undefined);
              setJobSearchResetKey((key) => key + 1);
              replaceQuery({ page: 1 });
            },
          },
          status !== undefined && {
            key: "status",
            label: `상태: ${operationalStatusLabel(status)}`,
            onRemove: () => replaceQuery({ status: undefined, page: 1 }),
          },
          kind !== undefined && {
            key: "kind",
            label: `작업 단계: ${jobKindLabel(kind)}`,
            onRemove: () => replaceQuery({ type: undefined, page: 1 }),
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
          userId !== undefined && {
            key: "user",
            label: `사용자 ID: ${userId}`,
            onRemove: () => {
              setUserInput("");
              setUserId(undefined);
              setUserError(undefined);
              replaceQuery({ page: 1 });
            },
          },
        ]}
        onReset={() => {
          setJobId(undefined);
          setJobSearchResetKey((key) => key + 1);
          setUserInput("");
          setUserId(undefined);
          setUserError(undefined);
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
  );

  return (
    <VStack gap="x6" alignItems="stretch">
      <RouteHeading
        title="생성 작업"
        description="원단 최종화·파일 내보내기 작업의 상태·지연·정제된 오류를 조회합니다."
      />

      <AdminCard title="작업 통계" description="현재 필터 기준 집계입니다.">
        {statsQuery.isError ? (
          <ContentPlaceholder
            title="작업 통계를 불러오지 못했습니다"
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
          <JobStatistics
            data={statsQuery.data}
            loading={statsQuery.isLoading}
          />
        )}
      </AdminCard>

      <RefreshStatus
        label="생성 작업"
        lastUpdatedAt={lastSuccessfulRefreshAt}
        paused={autoRefreshPaused}
        description="활성 작업이 있고 화면이 보일 때 30초마다 갱신합니다."
        onToggle={toggleAutoRefresh}
      />

      <PaginatedAdminTableCard
        title="생성 작업 목록"
        label="생성 작업 목록"
        columns={columns}
        rows={listQuery.data?.items}
        getRowKey={(row) => row.id}
        onRowClick={(row) => navigate(`/generation-jobs/${row.id}`)}
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
        emptyTitle="조건에 맞는 생성 작업이 없습니다"
        page={Math.min(parsed.page, totalPages)}
        totalPages={totalPages}
        onPageChange={(page) => replaceQuery({ page })}
        paginationLabel="생성 작업 목록 페이지"
        toolbar={toolbar}
      />
    </VStack>
  );
}

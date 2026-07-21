import type {
  GenerationJobStatsOut,
  GenerationJobSummaryOut,
  SeamlessStatsOut,
  SeamlessSummaryOut,
} from "@essesion/api-client";
import {
  getAdminGenerationJobStatsOptions,
  getAdminSeamlessStatsOptions,
  listAdminGenerationJobsOptions,
  listAdminSeamlessLogsOptions,
} from "@essesion/api-client/query";
import {
  ActionButton,
  Badge,
  Box,
  ContentPlaceholder,
  Grid,
  HStack,
  Skeleton,
  snackbar,
  TabContent,
  TabList,
  Tabs,
  TabTrigger,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";

import { formatDateTime } from "../../shared/lib/format";
import { activeAdminPollingInterval } from "../../shared/lib/polling";
import type { AdminListQuery } from "../../shared/lib/url-query";
import {
  useAdminListPageCorrection,
  useAdminListUrlState,
} from "../../shared/lib/use-admin-list-url-state";
import { AdminCard } from "../../shared/ui/admin-card";
import { AppliedFilterBar } from "../../shared/ui/applied-filter-bar";
import { CompactFilterToolbar } from "../../shared/ui/compact-filter-toolbar";
import { DateRangeFilters } from "../../shared/ui/date-range-filters";
import { FilterSelect } from "../../shared/ui/filter-select";
import { RouteHeading } from "../../shared/ui/route-heading";
import { SubmittedMemorySearch } from "../../shared/ui/submitted-memory-search";
import type { AdminTableColumn } from "../../widgets/admin-table/admin-table";
import { PaginatedAdminTableCard } from "../../widgets/admin-table/paginated-admin-table-card";
import { JOB_STATUS_LABELS, JOB_STATUSES } from "./job-status";

const TABS = ["jobs", "seamless"] as const;
const JOB_KINDS = ["finalize", "export"] as const;
const SEAMLESS_STATUSES = ["success", "partial", "error"] as const;
const OPERATIONAL_STATUS_LABELS: Record<string, string> = {
  ...JOB_STATUS_LABELS,
  success: "성공",
  partial: "부분 성공",
  error: "오류",
};
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

type GenerationTab = (typeof TABS)[number];
type JobStatus = (typeof JOB_STATUSES)[number];
type JobKind = (typeof JOB_KINDS)[number];
type SeamlessStatus = (typeof SEAMLESS_STATUSES)[number];

type ReplaceQuery = (changes: Partial<AdminListQuery>) => void;

function isOneOf<T extends string>(
  value: string | undefined,
  values: readonly T[],
): value is T {
  return value !== undefined && values.includes(value as T);
}

function periodBoundary(date: string | undefined, end: boolean) {
  if (date === undefined) return undefined;
  return `${date}T${end ? "23:59:59.999" : "00:00:00"}+09:00`;
}

function formatMilliseconds(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return `${Math.round(value).toLocaleString("ko-KR")}ms`;
}

function formatDuration(start: string, end: string) {
  const elapsed = new Date(end).valueOf() - new Date(start).valueOf();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "-";
  if (elapsed < 1_000) return `${elapsed}ms`;
  if (elapsed < 60_000) return `${(elapsed / 1_000).toFixed(1)}초`;
  return `${(elapsed / 60_000).toFixed(1)}분`;
}

function kindLabel(kind: JobKind) {
  return kind === "finalize" ? "원단 최종화" : "파일 내보내기";
}

function operationalStatusLabel(status: string) {
  return OPERATIONAL_STATUS_LABELS[status] ?? status;
}

function compactIdentifier(value: string) {
  return value.length <= 14 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function IdentifierLink({
  value,
  href,
  label,
}: {
  value: string;
  href: string;
  label: string;
}) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      snackbar(`${label}를 복사했습니다.`);
    } catch {
      snackbar(`${label}를 복사하지 못했습니다.`);
    }
  };

  return (
    <HStack gap="x1" wrap>
      <Link to={href} aria-label={`${label} ${value}`} title={value}>
        <Text textStyle="bodySm">{compactIdentifier(value)}</Text>
      </Link>
      <ActionButton
        type="button"
        variant="ghost"
        size="small"
        aria-label={`${label} 복사`}
        onClick={() => void copy()}
      >
        복사
      </ActionButton>
    </HStack>
  );
}

function OperationalStatusBadge({ status }: { status: string }) {
  const tone = ["succeeded", "success"].includes(status)
    ? "positive"
    : ["failed", "error"].includes(status)
      ? "critical"
      : ["queued", "partial"].includes(status)
        ? "warning"
        : status === "canceled"
          ? "neutral"
          : "informative";
  return <Badge tone={tone}>{operationalStatusLabel(status)}</Badge>;
}

function RefreshStatus({
  label,
  lastUpdatedAt,
  paused,
  description,
  onToggle,
}: {
  label: string;
  lastUpdatedAt: number;
  paused: boolean;
  description: string;
  onToggle: () => void;
}) {
  return (
    <HStack
      role="group"
      aria-label={`${label} 갱신 상태`}
      justify="space-between"
      align="center"
      gap="x3"
      wrap
    >
      <VStack gap="x1">
        <HStack gap="x2" align="center" wrap>
          <Badge tone={paused ? "warning" : "positive"}>
            {paused ? "자동 갱신 일시정지됨" : "자동 갱신 켜짐"}
          </Badge>
          <Text role="status" aria-live="polite" textStyle="bodySm">
            마지막 성공 갱신:{" "}
            {lastUpdatedAt === 0
              ? "아직 없음"
              : formatDateTime(new Date(lastUpdatedAt))}
          </Text>
        </HStack>
        <Text textStyle="caption" color="fg.neutral-muted">
          {paused
            ? "자동 갱신을 일시정지했습니다. 수동 새로고침은 계속 사용할 수 있습니다."
            : description}
        </Text>
      </VStack>
      <ActionButton variant="neutralOutline" size="small" onClick={onToggle}>
        {paused ? "자동 갱신 재개" : "자동 갱신 일시정지"}
      </ActionButton>
    </HStack>
  );
}

function MetricGrid({
  items,
  loading,
}: {
  items: readonly { label: string; value: string }[];
  loading: boolean;
}) {
  return (
    <Grid as="dl" columns={{ base: 2, md: 4 }} gap="x3">
      {items.map((item) => (
        <Box
          as="div"
          key={item.label}
          bg="bg.neutral-weak"
          borderRadius="r2"
          p="x3"
        >
          <VStack gap="x1">
            <Text as="dt" textStyle="caption" color="fg.neutral-muted">
              {item.label}
            </Text>
            {loading ? (
              <Skeleton width="70%" height={24} />
            ) : (
              <Text as="dd" textStyle="title3" className="m-0 tabular-nums">
                {item.value}
              </Text>
            )}
          </VStack>
        </Box>
      ))}
    </Grid>
  );
}

function PeriodFilters({
  from,
  to,
  onFromChange,
  onToChange,
}: {
  from?: string;
  to?: string;
  onFromChange: (value: string | undefined) => void;
  onToChange: (value: string | undefined) => void;
}) {
  return (
    <DateRangeFilters
      from={from}
      to={to}
      onFromChange={onFromChange}
      onToChange={onToChange}
      presentation="inline"
    />
  );
}

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

function JobsPanel({
  parsed,
  replaceQuery,
  autoRefreshPaused,
  onAutoRefreshPausedChange,
}: {
  parsed: AdminListQuery;
  replaceQuery: ReplaceQuery;
  autoRefreshPaused: boolean;
  onAutoRefreshPausedChange: (paused: boolean) => void;
}) {
  const navigate = useNavigate();
  const status = isOneOf(parsed.status, JOB_STATUSES)
    ? parsed.status
    : undefined;
  const kind = isOneOf(parsed.type, JOB_KINDS) ? parsed.type : undefined;
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
      onAutoRefreshPausedChange(false);
      void Promise.all([listQuery.refetch(), statsQuery.refetch()]);
      return;
    }
    onAutoRefreshPausedChange(true);
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
          href={`/generation-logs/jobs/${job.id}`}
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
      render: (job) => kindLabel(job.kind),
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
                { value: "finalize", label: "원단 최종화" },
                { value: "export", label: "파일 내보내기" },
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
            label: `작업 단계: ${kindLabel(kind)}`,
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
    <VStack gap="x5" alignItems="stretch">
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
        onRowClick={(row) => navigate(`/generation-logs/jobs/${row.id}`)}
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

function SeamlessPanel({
  parsed,
  replaceQuery,
  autoRefreshPaused,
  onAutoRefreshPausedChange,
}: {
  parsed: AdminListQuery;
  replaceQuery: ReplaceQuery;
  autoRefreshPaused: boolean;
  onAutoRefreshPausedChange: (paused: boolean) => void;
}) {
  const navigate = useNavigate();
  const status = isOneOf(parsed.status, SEAMLESS_STATUSES)
    ? parsed.status
    : undefined;
  const [draftStatus, setDraftStatus] = useState<SeamlessStatus | undefined>(
    status,
  );
  const [requestId, setRequestId] = useState<string>();
  const [requestSearchResetKey, setRequestSearchResetKey] = useState(0);
  const [draftFrom, setDraftFrom] = useState<string | undefined>(parsed.from);
  const [draftTo, setDraftTo] = useState<string | undefined>(parsed.to);
  const [lastSuccessfulRefreshAt, setLastSuccessfulRefreshAt] = useState(0);
  const commonQuery = {
    status,
    request_id: requestId,
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
      onAutoRefreshPausedChange(false);
      void Promise.all([listQuery.refetch(), statsQuery.refetch()]);
      return;
    }
    onAutoRefreshPausedChange(true);
  };

  const columns: readonly AdminTableColumn<SeamlessSummaryOut>[] = [
    {
      key: "id",
      header: "로그 ID",
      render: (log) => (
        <IdentifierLink
          value={log.id}
          href={`/generation-logs/seamless/${log.id}`}
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
      key: "render_ms",
      header: "렌더 시간",
      align: "end",
      visibility: "medium",
      render: (log) => formatMilliseconds(log.render_ms),
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
          ? `${log.error_summary}${log.failure_stage ? ` (${log.failure_stage})` : ""}`
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
            label="요청 ID 검색"
            placeholder="정확한 요청 ID 입력"
            maxLength={128}
            resetKey={requestSearchResetKey}
            validate={(value) =>
              SAFE_REQUEST_ID_PATTERN.test(value)
                ? undefined
                : "요청 ID 형식이 올바르지 않습니다."
            }
            onSubmit={(value) => {
              setRequestId(value);
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
                { value: "success", label: "성공" },
                { value: "partial", label: "부분 성공" },
                { value: "error", label: "오류" },
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
          requestId !== undefined && {
            key: "request",
            label: `요청 ID: ${requestId}`,
            onRemove: () => {
              setRequestId(undefined);
              setRequestSearchResetKey((key) => key + 1);
              replaceQuery({ page: 1 });
            },
          },
        ]}
        onReset={() => {
          setRequestId(undefined);
          setRequestSearchResetKey((key) => key + 1);
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
    <VStack gap="x5" alignItems="stretch">
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
        onRowClick={(row) => navigate(`/generation-logs/seamless/${row.id}`)}
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

export function GenerationOperationsPage() {
  const { query: parsed, replaceQuery } = useAdminListUrlState({
    allowedTabs: TABS,
    allowedStatuses: [...JOB_STATUSES, ...SEAMLESS_STATUSES],
    allowedTypes: JOB_KINDS,
  });
  const tab: GenerationTab = isOneOf(parsed.tab, TABS) ? parsed.tab : "jobs";
  const [autoRefreshPaused, setAutoRefreshPaused] = useState(false);

  return (
    <VStack gap="x6" alignItems="stretch">
      <RouteHeading
        title="생성 운영"
        description="생성 작업과 Seamless 로그의 상태·지연·정제된 오류를 조회합니다."
      />

      <Tabs
        value={tab}
        onValueChange={(value) =>
          replaceQuery({
            tab: value,
            page: 1,
            status: undefined,
            type: undefined,
          })
        }
      >
        <TabList aria-label="생성 운영 데이터 선택" triggerLayout="fill">
          <TabTrigger value="jobs">작업</TabTrigger>
          <TabTrigger value="seamless">Seamless</TabTrigger>
        </TabList>
        <TabContent value="jobs">
          <VStack pt="x5" alignItems="stretch">
            <JobsPanel
              parsed={parsed}
              replaceQuery={replaceQuery}
              autoRefreshPaused={autoRefreshPaused}
              onAutoRefreshPausedChange={setAutoRefreshPaused}
            />
          </VStack>
        </TabContent>
        <TabContent value="seamless">
          <VStack pt="x5" alignItems="stretch">
            <SeamlessPanel
              parsed={parsed}
              replaceQuery={replaceQuery}
              autoRefreshPaused={autoRefreshPaused}
              onAutoRefreshPausedChange={setAutoRefreshPaused}
            />
          </VStack>
        </TabContent>
      </Tabs>
    </VStack>
  );
}

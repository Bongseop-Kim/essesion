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
  Callout,
  Grid,
  HStack,
  Skeleton,
  TabContent,
  TabList,
  Tabs,
  TabTrigger,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";

import { formatDateTime } from "../../shared/lib/format";
import {
  activeAdminPollingInterval,
  generationPollingInterval,
} from "../../shared/lib/polling";
import type { AdminListQuery } from "../../shared/lib/url-query";
import {
  useAdminListPageCorrection,
  useAdminListUrlState,
} from "../../shared/lib/use-admin-list-url-state";
import { AdminCard } from "../../shared/ui/admin-card";
import { FilterSelect } from "../../shared/ui/filter-select";
import { RouteHeading } from "../../shared/ui/route-heading";
import type { AdminTableColumn } from "../../widgets/admin-table/admin-table";
import { PaginatedAdminTableCard } from "../../widgets/admin-table/paginated-admin-table-card";

const TABS = ["jobs", "seamless"] as const;
const JOB_STATUSES = ["queued", "processing", "succeeded", "failed"] as const;
const JOB_KINDS = ["finalize", "export"] as const;
const SEAMLESS_STATUSES = ["success", "partial", "error"] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

type GenerationTab = (typeof TABS)[number];
type JobKind = (typeof JOB_KINDS)[number];

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

function OperationalStatusBadge({ status }: { status: string }) {
  const tone = ["succeeded", "success"].includes(status)
    ? "positive"
    : ["failed", "error"].includes(status)
      ? "critical"
      : ["queued", "partial"].includes(status)
        ? "warning"
        : "informative";
  return <Badge tone={tone}>{status}</Badge>;
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
  query,
  replaceQuery,
}: {
  query: AdminListQuery;
  replaceQuery: ReplaceQuery;
}) {
  return (
    <>
      <TextField
        type="date"
        label="시작일 (KST)"
        value={query.from ?? ""}
        onChange={(event) =>
          replaceQuery({
            from: event.currentTarget.value || undefined,
            page: 1,
          })
        }
      />
      <TextField
        type="date"
        label="종료일 (KST)"
        value={query.to ?? ""}
        onChange={(event) =>
          replaceQuery({
            to: event.currentTarget.value || undefined,
            page: 1,
          })
        }
      />
    </>
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
}: {
  parsed: AdminListQuery;
  replaceQuery: ReplaceQuery;
}) {
  const status = isOneOf(parsed.status, JOB_STATUSES)
    ? parsed.status
    : undefined;
  const kind = isOneOf(parsed.type, JOB_KINDS) ? parsed.type : undefined;
  const [userInput, setUserInput] = useState("");
  const [userId, setUserId] = useState<string>();
  const [userError, setUserError] = useState<string>();
  const commonQuery = {
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
      generationPollingInterval(query.state.data?.items),
  });
  const statsQuery = useQuery({
    ...getAdminGenerationJobStatsOptions({ query: commonQuery }),
    refetchInterval: (query) =>
      activeAdminPollingInterval(
        (query.state.data?.queued ?? 0) + (query.state.data?.processing ?? 0) >
          0,
      ),
  });

  const submitUser = (event: FormEvent) => {
    event.preventDefault();
    const value = userInput.trim();
    if (value === "") {
      setUserError(undefined);
      setUserId(undefined);
      replaceQuery({ page: 1 });
      return;
    }
    if (!UUID_PATTERN.test(value)) {
      setUserError("사용자 ID는 UUID 형식이어야 합니다.");
      return;
    }
    setUserError(undefined);
    setUserId(value);
    replaceQuery({ page: 1 });
  };

  const columns: readonly AdminTableColumn<GenerationJobSummaryOut>[] = [
    {
      key: "id",
      header: "작업 ID",
      render: (job) => (
        <Link to={`/generation-logs/jobs/${job.id}`}>{job.id}</Link>
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

  return (
    <VStack gap="x5" alignItems="stretch">
      <AdminCard title="작업 필터">
        <VStack gap="x4" alignItems="stretch">
          <HStack gap="x3" align="flex-end" wrap>
            <FilterSelect
              label="상태"
              value={status ?? "all"}
              options={[
                { value: "all", label: "전체" },
                { value: "queued", label: "대기" },
                { value: "processing", label: "처리 중" },
                { value: "succeeded", label: "성공" },
                { value: "failed", label: "실패" },
              ]}
              onChange={(event) =>
                replaceQuery({
                  status:
                    event.currentTarget.value === "all"
                      ? undefined
                      : event.currentTarget.value,
                  page: 1,
                })
              }
            />
            <FilterSelect
              label="작업 단계"
              value={kind ?? "all"}
              options={[
                { value: "all", label: "전체" },
                { value: "finalize", label: "원단 최종화" },
                { value: "export", label: "파일 내보내기" },
              ]}
              onChange={(event) =>
                replaceQuery({
                  type:
                    event.currentTarget.value === "all"
                      ? undefined
                      : event.currentTarget.value,
                  page: 1,
                })
              }
            />
            <PeriodFilters query={parsed} replaceQuery={replaceQuery} />
          </HStack>
          <HStack
            as="form"
            gap="x2"
            align="flex-end"
            wrap
            onSubmit={submitUser}
          >
            <TextField
              label="사용자 ID"
              description="개인 식별자는 주소에 남기지 않고 메모리에서만 필터합니다."
              errorMessage={userError}
              value={userInput}
              onChange={(event) => setUserInput(event.currentTarget.value)}
            />
            <ActionButton type="submit" variant="neutralOutline">
              사용자 적용
            </ActionButton>
            {userId !== undefined && (
              <ActionButton
                variant="ghost"
                onClick={() => {
                  setUserInput("");
                  setUserId(undefined);
                  setUserError(undefined);
                  replaceQuery({ page: 1 });
                }}
              >
                사용자 해제
              </ActionButton>
            )}
          </HStack>
        </VStack>
      </AdminCard>

      <AdminCard title="작업 통계" description="현재 필터 기준 집계입니다.">
        {statsQuery.isError ? (
          <VStack gap="x3" alignItems="stretch">
            <Callout
              tone="warning"
              title="작업 통계를 불러오지 못했습니다"
              description="목록과 별도로 통계 조회를 다시 시도할 수 있습니다."
            />
            <ActionButton
              variant="neutralOutline"
              onClick={() => void statsQuery.refetch()}
            >
              통계 다시 시도
            </ActionButton>
          </VStack>
        ) : (
          <JobStatistics
            data={statsQuery.data}
            loading={statsQuery.isLoading}
          />
        )}
      </AdminCard>

      <PaginatedAdminTableCard
        title="생성 작업 목록"
        description={`총 ${listQuery.data?.total ?? 0}건 · 활성 작업은 30초마다 갱신`}
        label="생성 작업 목록"
        columns={columns}
        rows={listQuery.data?.items}
        getRowKey={(row) => row.id}
        status={
          listQuery.isLoading
            ? "loading"
            : listQuery.isError
              ? "error"
              : "success"
        }
        total={listQuery.data?.total}
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
      />
    </VStack>
  );
}

function SeamlessPanel({
  parsed,
  replaceQuery,
}: {
  parsed: AdminListQuery;
  replaceQuery: ReplaceQuery;
}) {
  const status = isOneOf(parsed.status, SEAMLESS_STATUSES)
    ? parsed.status
    : undefined;
  const [requestInput, setRequestInput] = useState("");
  const [requestId, setRequestId] = useState<string>();
  const [requestError, setRequestError] = useState<string>();
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
  });
  const statsQuery = useQuery({
    ...getAdminSeamlessStatsOptions({ query: commonQuery }),
  });

  const submitRequestId = (event: FormEvent) => {
    event.preventDefault();
    const value = requestInput.trim();
    if (value === "") {
      setRequestError(undefined);
      setRequestId(undefined);
      replaceQuery({ page: 1 });
      return;
    }
    if (!SAFE_REQUEST_ID_PATTERN.test(value)) {
      setRequestError("request_id 형식이 올바르지 않습니다.");
      return;
    }
    setRequestError(undefined);
    setRequestId(value);
    replaceQuery({ page: 1 });
  };

  const columns: readonly AdminTableColumn<SeamlessSummaryOut>[] = [
    {
      key: "id",
      header: "로그 ID",
      render: (log) => (
        <Link to={`/generation-logs/seamless/${log.id}`}>{log.id}</Link>
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
      render: (log) => log.error_summary ?? "-",
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

  return (
    <VStack gap="x5" alignItems="stretch">
      <AdminCard title="Seamless 필터">
        <VStack gap="x4" alignItems="stretch">
          <HStack gap="x3" align="flex-end" wrap>
            <FilterSelect
              label="상태"
              value={status ?? "all"}
              options={[
                { value: "all", label: "전체" },
                { value: "success", label: "성공" },
                { value: "partial", label: "부분 성공" },
                { value: "error", label: "오류" },
              ]}
              onChange={(event) =>
                replaceQuery({
                  status:
                    event.currentTarget.value === "all"
                      ? undefined
                      : event.currentTarget.value,
                  page: 1,
                })
              }
            />
            <PeriodFilters query={parsed} replaceQuery={replaceQuery} />
          </HStack>
          <HStack
            as="form"
            gap="x2"
            align="flex-end"
            wrap
            onSubmit={submitRequestId}
          >
            <TextField
              label="request_id"
              description="요청 추적용 안전 식별자를 정확히 입력합니다."
              errorMessage={requestError}
              value={requestInput}
              maxLength={128}
              onChange={(event) => setRequestInput(event.currentTarget.value)}
            />
            <ActionButton type="submit" variant="neutralOutline">
              요청 ID 적용
            </ActionButton>
            {requestId !== undefined && (
              <ActionButton
                variant="ghost"
                onClick={() => {
                  setRequestInput("");
                  setRequestId(undefined);
                  setRequestError(undefined);
                  replaceQuery({ page: 1 });
                }}
              >
                요청 ID 해제
              </ActionButton>
            )}
          </HStack>
        </VStack>
      </AdminCard>

      <AdminCard title="Seamless 통계" description="현재 필터 기준 집계입니다.">
        {statsQuery.isError ? (
          <VStack gap="x3" alignItems="stretch">
            <Callout
              tone="warning"
              title="Seamless 통계를 불러오지 못했습니다"
              description="목록과 별도로 통계 조회를 다시 시도할 수 있습니다."
            />
            <ActionButton
              variant="neutralOutline"
              onClick={() => void statsQuery.refetch()}
            >
              통계 다시 시도
            </ActionButton>
          </VStack>
        ) : (
          <SeamlessStatistics
            data={statsQuery.data}
            loading={statsQuery.isLoading}
          />
        )}
      </AdminCard>

      <PaginatedAdminTableCard
        title="Seamless 로그 목록"
        description={`총 ${listQuery.data?.total ?? 0}건`}
        label="Seamless 로그 목록"
        columns={columns}
        rows={listQuery.data?.items}
        getRowKey={(row) => row.id}
        status={
          listQuery.isLoading
            ? "loading"
            : listQuery.isError
              ? "error"
              : "success"
        }
        total={listQuery.data?.total}
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

  return (
    <VStack gap="x6" alignItems="stretch">
      <RouteHeading
        title="생성 운영"
        description="generation_jobs와 Seamless 생성 로그의 상태·지연·정제된 오류를 조회합니다."
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
            <JobsPanel parsed={parsed} replaceQuery={replaceQuery} />
          </VStack>
        </TabContent>
        <TabContent value="seamless">
          <VStack pt="x5" alignItems="stretch">
            <SeamlessPanel parsed={parsed} replaceQuery={replaceQuery} />
          </VStack>
        </TabContent>
      </Tabs>
    </VStack>
  );
}

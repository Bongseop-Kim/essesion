import type { AuthoringExampleSummaryOut } from "@essesion/api-client";
import {
  getAuthoringExamplePreviewOptions,
  listAuthoringExamplesOptions,
} from "@essesion/api-client/query";
import {
  ActionButton,
  Badge,
  Box,
  HStack,
  ImageFrame,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";

import { formatDateTime } from "../../shared/lib/format";
import {
  useAdminListPageCorrection,
  useAdminListUrlState,
} from "../../shared/lib/use-admin-list-url-state";
import { useAdminSession } from "../../shared/session/admin-session";
import { AppliedFilterBar } from "../../shared/ui/applied-filter-bar";
import { CompactFilterToolbar } from "../../shared/ui/compact-filter-toolbar";
import { FilterSelect } from "../../shared/ui/filter-select";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";
import { SubmittedMemorySearch } from "../../shared/ui/submitted-memory-search";
import type { AdminTableColumn } from "../../widgets/admin-table/admin-table";
import { PaginatedAdminTableCard } from "../../widgets/admin-table/paginated-admin-table-card";

const ACTIVE_FILTERS = ["active", "inactive"] as const;
const ACTIVE_LABELS = {
  all: "전체",
  active: "활성",
  inactive: "비활성",
} as const;
const SOURCE_LABELS = {
  authored: "직접 작성",
  promoted: "선별",
  bootstrap: "초기 시범",
} as const;

type ActiveFilter = keyof typeof ACTIVE_LABELS;

function ExamplePreviewCell({ row }: { row: AuthoringExampleSummaryOut }) {
  const options = getAuthoringExamplePreviewOptions({
    path: { example_id: row.id },
  });
  const query = useQuery({
    ...options,
    /* plan 수정은 updated_at을 바꾼다 — 키에 넣어 편집 후 캐시를 무효화 */
    queryKey: [
      { ...options.queryKey[0], updated_at: row.updated_at },
    ] as unknown as typeof options.queryKey,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  return (
    <Box width={44}>
      {query.isPending ? (
        <Skeleton width={44} height={44} radius="r2" />
      ) : (
        <ImageFrame
          ratio={1}
          fit="contain"
          stroke
          src={
            query.data === undefined
              ? undefined
              : `data:image/svg+xml;utf8,${encodeURIComponent(query.data.svg)}`
          }
          alt="타일 프리뷰"
        />
      )}
    </Box>
  );
}

const columns: readonly AdminTableColumn<AuthoringExampleSummaryOut>[] = [
  {
    key: "preview",
    header: "프리뷰",
    render: (row) => <ExamplePreviewCell row={row} />,
  },
  {
    key: "example_id",
    header: "시범",
    render: (row) => (
      <VStack gap="x0_5" alignItems="stretch">
        <Text textStyle="bodySm" className="line-clamp-2">
          {row.retrieval_text}
        </Text>
        <Text textStyle="caption" color="fg.neutral-muted">
          {row.example_id}
        </Text>
      </VStack>
    ),
  },
  {
    key: "source",
    header: "출처",
    render: (row) => (
      <Badge
        tone={
          row.source === "authored"
            ? "positive"
            : row.source === "promoted"
              ? "informative"
              : "neutral"
        }
      >
        {SOURCE_LABELS[row.source]}
      </Badge>
    ),
  },
  {
    key: "structure",
    header: "구조",
    visibility: "medium",
    render: (row) => `${row.family} · motif ${row.motif_count}`,
  },
  {
    key: "updated_at",
    header: "최근 변경",
    visibility: "large",
    render: (row) => formatDateTime(row.updated_at),
  },
  {
    key: "active",
    header: "few-shot 주입",
    render: (row) => (
      <StatusBadge status={row.active ? "active" : "inactive"} />
    ),
  },
];

export function FewShotExamplesPage() {
  const navigate = useNavigate();
  const { state } = useAdminSession();
  const canEdit =
    state.status === "authenticated" && state.session.role === "admin";
  const { query: parsed, replaceQuery } = useAdminListUrlState({
    allowedStatuses: ACTIVE_FILTERS,
  });
  const active = (parsed.status ?? "all") as ActiveFilter;
  const [draftActive, setDraftActive] = useState(active);
  const [search, setSearch] = useState<string>();
  const [searchResetKey, setSearchResetKey] = useState(0);
  const query = useQuery({
    ...listAuthoringExamplesOptions({
      query: {
        active,
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
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title="선별된 few-shot"
          description="생성 프롬프트의 few-shot 검색에 주입되는 intent 시범을 저작하고 활성 상태를 관리합니다."
        />
        {canEdit && (
          <ActionButton onClick={() => navigate("/few-shot-examples/new")}>
            새 시범 작성
          </ActionButton>
        )}
      </HStack>

      <PaginatedAdminTableCard
        title="선별된 few-shot 시범"
        label="few-shot 시범 셋"
        columns={columns}
        rows={query.data?.items}
        getRowKey={(row) => row.id}
        onRowClick={(row) => navigate(`/few-shot-examples/${row.id}`)}
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
        emptyTitle="조건에 맞는 few-shot 시범이 없습니다"
        page={Math.min(parsed.page, totalPages)}
        totalPages={totalPages}
        onPageChange={(page) => replaceQuery({ page })}
        paginationLabel="few-shot 시범 셋 페이지"
        toolbar={
          <VStack gap="x3" alignItems="stretch">
            <CompactFilterToolbar
              primaryControls={
                <SubmittedMemorySearch
                  label="intent 또는 시범 ID 검색"
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
                  label="few-shot 주입 상태"
                  presentation="inline"
                  value={draftActive}
                  options={[
                    { value: "all", label: ACTIVE_LABELS.all },
                    { value: "active", label: ACTIVE_LABELS.active },
                    { value: "inactive", label: ACTIVE_LABELS.inactive },
                  ]}
                  onValueChange={(value) =>
                    setDraftActive(value as ActiveFilter)
                  }
                />
              }
              secondaryFilterCount={Number(parsed.status !== undefined)}
              secondaryTitle="few-shot 시범 필터"
              secondaryDescription="few-shot 주입 상태를 골라 한 번에 적용합니다."
              onOpenSecondaryFilters={() => setDraftActive(active)}
              onCancelSecondaryFilters={() => setDraftActive(active)}
              onApplySecondaryFilters={() => {
                replaceQuery({
                  status: draftActive === "all" ? undefined : draftActive,
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
                  key: "active",
                  label: `few-shot 주입: ${ACTIVE_LABELS[active]}`,
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

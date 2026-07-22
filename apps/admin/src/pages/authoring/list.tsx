import type {
  AuthoringCandidateSummaryOut,
  AuthoringExampleSummaryOut,
} from "@essesion/api-client";
import {
  listAuthoringCandidatesOptions,
  listAuthoringExamplesOptions,
} from "@essesion/api-client/query";
import {
  Badge,
  HStack,
  TabContent,
  TabList,
  Tabs,
  TabTrigger,
  Text,
  VStack,
} from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { formatDateTime } from "../../shared/lib/format";
import { FilterSelect } from "../../shared/ui/filter-select";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";
import { SubmittedMemorySearch } from "../../shared/ui/submitted-memory-search";
import type { AdminTableColumn } from "../../widgets/admin-table/admin-table";
import { PaginatedAdminTableCard } from "../../widgets/admin-table/paginated-admin-table-card";

type CandidateStatus =
  | "all"
  | "pending"
  | "hold"
  | "rejected"
  | "approved"
  | "duplicate"
  | "invalid";
type ActiveFilter = "all" | "active" | "inactive";
type AuthoringTab = "candidates" | "examples";

const CANDIDATE_STATUSES = new Set<CandidateStatus>([
  "all",
  "pending",
  "hold",
  "rejected",
  "approved",
  "duplicate",
  "invalid",
]);
const ACTIVE_FILTERS = new Set<ActiveFilter>(["all", "active", "inactive"]);
const PAGE_SIZE = 20;

function pageFrom(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function candidateColumns(): readonly AdminTableColumn<AuthoringCandidateSummaryOut>[] {
  return [
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
}

function exampleColumns(): readonly AdminTableColumn<AuthoringExampleSummaryOut>[] {
  return [
    {
      key: "example_id",
      header: "예시",
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
        <Badge tone={row.source === "promoted" ? "informative" : "neutral"}>
          {row.source === "promoted" ? "승격" : "초기 예시"}
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
      header: "RAG",
      render: (row) => (
        <StatusBadge status={row.active ? "active" : "inactive"} />
      ),
    },
  ];
}

function CandidateList({ page }: { page: number }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawStatus = params.get("status") as CandidateStatus | null;
  const status =
    rawStatus !== null && CANDIDATE_STATUSES.has(rawStatus)
      ? rawStatus
      : "pending";
  const [search, setSearch] = useState<string>();
  const query = useQuery({
    ...listAuthoringCandidatesOptions({
      query: {
        status,
        q: search,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      },
    }),
    placeholderData: keepPreviousData,
  });
  const totalPages = Math.max(
    1,
    Math.ceil((query.data?.total ?? 0) / PAGE_SIZE),
  );
  const update = (values: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };

  return (
    <PaginatedAdminTableCard
      title="승격 검토 대상"
      description="선택 후 성공적으로 실사화된 Plan v3 결과만 등록됩니다."
      label="저작 예시 승격 후보"
      columns={candidateColumns()}
      rows={query.data?.items}
      getRowKey={(row) => row.id}
      onRowClick={(row) => navigate(`/authoring-examples/candidates/${row.id}`)}
      status={
        query.isLoading || query.isPlaceholderData
          ? "loading"
          : query.isError
            ? "error"
            : "success"
      }
      total={query.data?.total}
      limit={PAGE_SIZE}
      refreshing={query.isFetching}
      onRefresh={() => void query.refetch()}
      emptyTitle="조건에 맞는 승격 후보가 없습니다"
      page={Math.min(page, totalPages)}
      totalPages={totalPages}
      onPageChange={(nextPage) => update({ page: String(nextPage) })}
      paginationLabel="저작 예시 승격 후보 페이지"
      toolbar={
        <HStack gap="x3" align="flex-end" wrap>
          <FilterSelect
            label="검토 상태"
            value={status}
            options={[
              { value: "pending", label: "검토 대기" },
              { value: "hold", label: "보류" },
              { value: "approved", label: "승인" },
              { value: "rejected", label: "거절" },
              { value: "duplicate", label: "자동 중복" },
              { value: "invalid", label: "자동 제외" },
              { value: "all", label: "전체" },
            ]}
            onValueChange={(value) =>
              update({ status: value, page: undefined })
            }
          />
          <SubmittedMemorySearch
            label="요청 또는 식별자 검색"
            placeholder="2자 이상 입력"
            maxLength={200}
            onSubmit={(value) => {
              setSearch(value);
              update({ page: undefined });
            }}
          />
        </HStack>
      }
    />
  );
}

function ExampleList({ page }: { page: number }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawActive = params.get("active") as ActiveFilter | null;
  const active =
    rawActive !== null && ACTIVE_FILTERS.has(rawActive) ? rawActive : "all";
  const [search, setSearch] = useState<string>();
  const query = useQuery({
    ...listAuthoringExamplesOptions({
      query: {
        active,
        q: search,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      },
    }),
    placeholderData: keepPreviousData,
  });
  const totalPages = Math.max(
    1,
    Math.ceil((query.data?.total ?? 0) / PAGE_SIZE),
  );
  const update = (values: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };

  return (
    <PaginatedAdminTableCard
      title="승인 예시"
      description="active 예시만 다음 RAG 검색에 즉시 사용됩니다."
      label="승인된 저작 예시"
      columns={exampleColumns()}
      rows={query.data?.items}
      getRowKey={(row) => row.id}
      onRowClick={(row) => navigate(`/authoring-examples/active/${row.id}`)}
      status={
        query.isLoading || query.isPlaceholderData
          ? "loading"
          : query.isError
            ? "error"
            : "success"
      }
      total={query.data?.total}
      limit={PAGE_SIZE}
      refreshing={query.isFetching}
      onRefresh={() => void query.refetch()}
      emptyTitle="조건에 맞는 승인 예시가 없습니다"
      page={Math.min(page, totalPages)}
      totalPages={totalPages}
      onPageChange={(nextPage) => update({ page: String(nextPage) })}
      paginationLabel="승인된 저작 예시 페이지"
      toolbar={
        <HStack gap="x3" align="flex-end" wrap>
          <FilterSelect
            label="RAG 상태"
            value={active}
            options={[
              { value: "all", label: "전체" },
              { value: "active", label: "활성" },
              { value: "inactive", label: "비활성" },
            ]}
            onValueChange={(value) =>
              update({ active: value, page: undefined })
            }
          />
          <SubmittedMemorySearch
            label="요청 또는 예시 ID 검색"
            placeholder="2자 이상 입력"
            maxLength={200}
            onSubmit={(value) => {
              setSearch(value);
              update({ page: undefined });
            }}
          />
        </HStack>
      }
    />
  );
}

export function AuthoringExamplesPage() {
  const [params, setParams] = useSearchParams();
  const tab: AuthoringTab =
    params.get("tab") === "examples" ? "examples" : "candidates";
  const page = pageFrom(params.get("page"));
  const setTab = (next: string) => {
    const nextParams = new URLSearchParams();
    if (next === "examples") nextParams.set("tab", "examples");
    setParams(nextParams, { replace: true });
  };

  return (
    <VStack gap="x6" alignItems="stretch">
      <RouteHeading
        title="RAG 예시"
        description="생성 결과의 승격 검토 이력과 현재 검색에 참여하는 승인 예시를 추적합니다."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabList aria-label="RAG 예시 관리 메뉴" triggerLayout="fill">
          <TabTrigger value="candidates">승격 후보</TabTrigger>
          <TabTrigger value="examples">승인 예시</TabTrigger>
        </TabList>
        <TabContent value="candidates">
          <VStack pt="x5" alignItems="stretch">
            <CandidateList page={page} />
          </VStack>
        </TabContent>
        <TabContent value="examples">
          <VStack pt="x5" alignItems="stretch">
            <ExampleList page={page} />
          </VStack>
        </TabContent>
      </Tabs>
    </VStack>
  );
}

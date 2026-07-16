import type { MotifSummaryOut } from "@essesion/api-client";
import { listAdminMotifsOptions } from "@essesion/api-client/query";
import { Box, ImageFrame, Text, VStack } from "@essesion/shared";
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
import { SubmittedMemorySearch } from "../../shared/ui/submitted-memory-search";
import type { AdminTableColumn } from "../../widgets/admin-table/admin-table";
import { PaginatedAdminTableCard } from "../../widgets/admin-table/paginated-admin-table-card";
import { motifPreviewDocument } from "./detail";

const SCOPES = ["whole", "partial"] as const;

type MotifScope = (typeof SCOPES)[number];

function isScope(value: string | undefined): value is MotifScope {
  return value !== undefined && SCOPES.includes(value as MotifScope);
}

function MotifPreviewCell({ motif }: { motif: MotifSummaryOut }) {
  const doc =
    motif.svg_status === "safe"
      ? motifPreviewDocument(motif.symbol, motif.bbox)
      : null;
  return (
    <Box width={44}>
      <ImageFrame
        ratio={1}
        fit="contain"
        stroke
        src={
          doc === null || doc === ""
            ? undefined
            : `data:image/svg+xml;utf8,${encodeURIComponent(doc)}`
        }
        alt={`${motif.subject ?? motif.id} 미리보기`}
      />
    </Box>
  );
}

const columns: readonly AdminTableColumn<MotifSummaryOut>[] = [
  {
    key: "preview",
    header: "미리보기",
    render: (motif) => <MotifPreviewCell motif={motif} />,
  },
  {
    key: "subject",
    header: "Motif",
    render: (motif) => (
      <VStack gap="x0_5">
        <Link to={`/motifs/${motif.id}`}>
          <Text textStyle="bodySm">{motif.subject ?? motif.id}</Text>
        </Link>
        <Text textStyle="caption" color="fg.neutral-muted">
          {motif.id}
        </Text>
      </VStack>
    ),
  },
  {
    key: "metadata",
    header: "메타데이터",
    render: (motif) =>
      [motif.scope, motif.view, motif.expression, motif.style]
        .filter((value) => value !== null)
        .join(" · ") || "-",
  },
  {
    key: "source",
    header: "소스",
    render: (motif) => motif.source,
  },
  {
    key: "quality",
    header: "품질",
    align: "end",
    visibility: "medium",
    render: (motif) =>
      motif.quality === null ? "-" : motif.quality.toFixed(3),
  },
  {
    key: "colors",
    header: "색상 슬롯",
    align: "end",
    visibility: "large",
    render: (motif) => `${motif.color_slot_count}개`,
  },
  {
    key: "created_at",
    header: "생성일",
    visibility: "large",
    render: (motif) => formatDateTime(motif.created_at),
  },
];

export function MotifsPage() {
  const navigate = useNavigate();
  const { query: parsed, replaceQuery } = useAdminListUrlState({
    allowedTypes: SCOPES,
  });
  const scope = isScope(parsed.type) ? parsed.type : undefined;
  const [draftScope, setDraftScope] = useState<MotifScope | undefined>(scope);
  const [search, setSearch] = useState<string>();
  const [searchResetKey, setSearchResetKey] = useState(0);
  const [draftFrom, setDraftFrom] = useState(parsed.from);
  const [draftTo, setDraftTo] = useState(parsed.to);
  const query = useQuery({
    ...listAdminMotifsOptions({
      query: {
        scope,
        q: search,
        start_date: parsed.from,
        end_date: parsed.to,
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
        title="Motif SVG"
        description="등록된 Motif 메타데이터와 서버 안전성 검사를 통과한 SVG를 읽기 전용으로 조회합니다."
      />

      <PaginatedAdminTableCard
        title="Motif 목록"
        label="Motif 목록"
        columns={columns}
        rows={query.data?.items}
        getRowKey={(row) => row.id}
        onRowClick={(motif) => navigate(`/motifs/${motif.id}`)}
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
        emptyTitle="조건에 맞는 Motif가 없습니다"
        page={Math.min(parsed.page, totalPages)}
        totalPages={totalPages}
        onPageChange={(page) => replaceQuery({ page })}
        paginationLabel="Motif 목록 페이지"
        toolbar={
          <VStack gap="x3" alignItems="stretch">
            <CompactFilterToolbar
              primaryControls={
                <SubmittedMemorySearch
                  label="Motif ID·이름·소스 검색"
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
                    label="범위"
                    presentation="inline"
                    value={draftScope ?? "all"}
                    options={[
                      { value: "all", label: "전체" },
                      { value: "whole", label: "전체 모티프" },
                      { value: "partial", label: "부분 모티프" },
                    ]}
                    onValueChange={(value) =>
                      setDraftScope(
                        value === "all" ? undefined : (value as MotifScope),
                      )
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
                Number(scope !== undefined) +
                Number(parsed.from !== undefined) +
                Number(parsed.to !== undefined)
              }
              secondaryTitle="Motif 필터"
              secondaryDescription="Motif 범위와 생성일을 한 번에 적용합니다."
              onOpenSecondaryFilters={() => {
                setDraftScope(scope);
                setDraftFrom(parsed.from);
                setDraftTo(parsed.to);
              }}
              onApplySecondaryFilters={() => {
                replaceQuery({
                  type: draftScope,
                  from: draftFrom,
                  to: draftTo,
                  page: 1,
                });
              }}
              onCancelSecondaryFilters={() => {
                setDraftScope(scope);
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
                scope !== undefined && {
                  key: "scope",
                  label: `범위: ${scope === "whole" ? "전체 모티프" : "부분 모티프"}`,
                  onRemove: () => replaceQuery({ type: undefined, page: 1 }),
                },
                parsed.from !== undefined && {
                  key: "from",
                  label: `생성 시작일: ${parsed.from}`,
                  onRemove: () => replaceQuery({ from: undefined, page: 1 }),
                },
                parsed.to !== undefined && {
                  key: "to",
                  label: `생성 종료일: ${parsed.to}`,
                  onRemove: () => replaceQuery({ to: undefined, page: 1 }),
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

import type { MotifSummaryOut } from "@essesion/api-client";
import { listAdminMotifsOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  HStack,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";

import { formatDateTime } from "../../shared/lib/format";
import {
  useAdminListPageCorrection,
  useAdminListUrlState,
} from "../../shared/lib/use-admin-list-url-state";
import { AdminCard } from "../../shared/ui/admin-card";
import { FilterSelect } from "../../shared/ui/filter-select";
import { RouteHeading } from "../../shared/ui/route-heading";
import type { AdminTableColumn } from "../../widgets/admin-table/admin-table";
import { PaginatedAdminTableCard } from "../../widgets/admin-table/paginated-admin-table-card";

const SCOPES = ["whole", "partial"] as const;
const SAFE_SOURCE_PATTERN = /^[A-Za-z0-9_.:-]{1,50}$/;

type MotifScope = (typeof SCOPES)[number];

function isScope(value: string | undefined): value is MotifScope {
  return value !== undefined && SCOPES.includes(value as MotifScope);
}

const columns: readonly AdminTableColumn<MotifSummaryOut>[] = [
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
  const [sourceInput, setSourceInput] = useState("");
  const [source, setSource] = useState<string>();
  const [sourceError, setSourceError] = useState<string>();
  const query = useQuery({
    ...listAdminMotifsOptions({
      query: {
        scope,
        source,
        limit: parsed.limit,
        offset: (parsed.page - 1) * parsed.limit,
      },
    }),
    placeholderData: keepPreviousData,
  });

  const submitSource = (event: FormEvent) => {
    event.preventDefault();
    const value = sourceInput.trim();
    if (value === "") {
      setSource(undefined);
      setSourceError(undefined);
      replaceQuery({ page: 1 });
      return;
    }
    if (!SAFE_SOURCE_PATTERN.test(value)) {
      setSourceError("소스는 영문·숫자와 . _ : -만 입력할 수 있습니다.");
      return;
    }
    setSource(value);
    setSourceError(undefined);
    replaceQuery({ page: 1 });
  };

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

      <AdminCard title="Motif 필터">
        <HStack gap="x3" align="flex-end" wrap>
          <FilterSelect
            label="범위"
            value={scope ?? "all"}
            options={[
              { value: "all", label: "전체" },
              { value: "whole", label: "전체 모티프" },
              { value: "partial", label: "부분 모티프" },
            ]}
            onValueChange={(value) => {
              replaceQuery({
                type: value === "all" ? undefined : value,
                page: 1,
              });
            }}
          />
          <HStack
            as="form"
            gap="x2"
            align="flex-end"
            wrap
            onSubmit={submitSource}
          >
            <TextField
              label="소스"
              placeholder="정확한 source 키"
              value={sourceInput}
              maxLength={50}
              errorMessage={sourceError}
              onChange={(event) => setSourceInput(event.currentTarget.value)}
            />
            <ActionButton type="submit" variant="neutralOutline">
              소스 적용
            </ActionButton>
            {source !== undefined && (
              <ActionButton
                variant="ghost"
                onClick={() => {
                  setSourceInput("");
                  setSource(undefined);
                  setSourceError(undefined);
                  replaceQuery({ page: 1 });
                }}
              >
                소스 해제
              </ActionButton>
            )}
          </HStack>
        </HStack>
      </AdminCard>

      <PaginatedAdminTableCard
        title="Motif 목록"
        description={`총 ${query.data?.total ?? 0}건`}
        label="Motif 목록"
        columns={columns}
        rows={query.data?.items}
        getRowKey={(row) => row.id}
        onRowClick={(motif) => navigate(`/motifs/${motif.id}`)}
        status={
          query.isLoading ? "loading" : query.isError ? "error" : "success"
        }
        total={query.data?.total}
        refreshing={query.isFetching}
        onRefresh={() => void query.refetch()}
        emptyTitle="조건에 맞는 Motif가 없습니다"
        page={Math.min(parsed.page, totalPages)}
        totalPages={totalPages}
        onPageChange={(page) => replaceQuery({ page })}
        paginationLabel="Motif 목록 페이지"
      />
    </VStack>
  );
}

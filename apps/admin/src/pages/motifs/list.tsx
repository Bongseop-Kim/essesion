import type { MotifSummaryOut } from "@essesion/api-client";
import {
  getAdminMotifOptions,
  listAdminMotifsOptions,
} from "@essesion/api-client/query";
import {
  ActionButton,
  ContentPlaceholder,
  Grid,
  HStack,
  Skeleton,
  Tag,
  TagGroup,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router";

import { formatDateTime, formatIdentifier } from "../../shared/lib/format";
import {
  type AdminListQuery,
  parseAdminListQuery,
  serializeAdminListQuery,
} from "../../shared/lib/url-query";
import { AdminCard } from "../../shared/ui/admin-card";
import { DetailList } from "../../shared/ui/detail-list";
import { FilterSelect } from "../../shared/ui/filter-select";
import { RouteHeading } from "../../shared/ui/route-heading";
import {
  AdminTable,
  type AdminTableColumn,
} from "../../widgets/admin-table/admin-table";
import { Pagination } from "../../widgets/admin-table/pagination";
import { SafeSvgPreview } from "../generation/safe-svg-preview";

const SCOPES = ["whole", "partial"] as const;
const SAFE_SOURCE_PATTERN = /^[A-Za-z0-9_.:-]{1,50}$/;

type MotifScope = (typeof SCOPES)[number];

function isScope(value: string | undefined): value is MotifScope {
  return value !== undefined && SCOPES.includes(value as MotifScope);
}

export function motifPreviewDocument(
  symbol: string | null,
  bbox: readonly number[],
) {
  if (symbol === null) return null;
  const trimmed = symbol.trim();
  if (trimmed.startsWith("<svg")) return trimmed;
  if (!/^<symbol(?:\s|>)/.test(trimmed) || !trimmed.endsWith("</symbol>")) {
    return trimmed;
  }
  const [minX = 0, minY = 0, maxX = 100, maxY = 100] = bbox;
  const hasUsableBbox =
    bbox.length === 4 &&
    bbox.every(Number.isFinite) &&
    maxX > minX &&
    maxY > minY;
  const viewBox = hasUsableBbox
    ? `${minX} ${minY} ${maxX - minX} ${maxY - minY}`
    : "0 0 100 100";
  return trimmed
    .replace(
      /^<symbol\b/,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"`,
    )
    .replace(/<\/symbol>$/, "</svg>");
}

function MotifDetail({ motifId }: { motifId: string }) {
  const query = useQuery({
    ...getAdminMotifOptions({ path: { motif_id: motifId } }),
    enabled: motifId !== "",
  });

  if (query.isLoading) {
    return (
      <AdminCard title="Motif 상세">
        <Grid columns={{ base: 1, md: 2 }} gap="x4" aria-busy="true">
          <Skeleton width="100%" height={320} />
          <VStack gap="x3" alignItems="stretch">
            <Skeleton width="70%" height={24} />
            <Skeleton width="100%" height={20} />
            <Skeleton width="80%" height={20} />
          </VStack>
        </Grid>
      </AdminCard>
    );
  }

  if (query.isError || query.data === undefined) {
    return (
      <AdminCard title="Motif 상세">
        <ContentPlaceholder
          title="Motif 상세를 불러오지 못했습니다"
          description="다른 Motif를 선택하거나 다시 시도해 주세요."
          action={
            <ActionButton onClick={() => void query.refetch()}>
              다시 시도
            </ActionButton>
          }
        />
      </AdminCard>
    );
  }

  const motif = query.data;
  const preview =
    motif.svg_status === "safe"
      ? motifPreviewDocument(motif.symbol, motif.bbox)
      : motif.symbol;

  return (
    <AdminCard
      title={motif.subject ?? motif.id}
      description={`Motif ID: ${motif.id} · SVG 상태: ${motif.svg_status}`}
    >
      <Grid columns={{ base: 1, md: 2 }} gap="x5">
        <SafeSvgPreview
          svg={preview}
          status={motif.svg_status}
          alt={`${motif.subject ?? motif.id} Motif 안전 미리보기`}
        />
        <VStack gap="x4" alignItems="stretch">
          <DetailList
            items={[
              { label: "주제", value: formatIdentifier(motif.subject) },
              { label: "범위", value: formatIdentifier(motif.scope) },
              { label: "뷰", value: formatIdentifier(motif.view) },
              { label: "표현", value: formatIdentifier(motif.expression) },
              { label: "스타일", value: formatIdentifier(motif.style) },
              { label: "소스", value: motif.source },
              {
                label: "품질",
                value: motif.quality === null ? "-" : motif.quality.toFixed(3),
              },
              {
                label: "변형 그룹",
                value: formatIdentifier(motif.variant_group),
              },
              { label: "색상 슬롯", value: `${motif.color_slot_count}개` },
              { label: "생성일", value: formatDateTime(motif.created_at) },
              {
                label: "bbox",
                value: motif.bbox.length === 4 ? motif.bbox.join(", ") : "-",
              },
              {
                label: "anchor",
                value:
                  motif.anchor.length === 2 ? motif.anchor.join(", ") : "-",
              },
            ]}
          />
          {motif.description !== null && (
            <VStack gap="x1">
              <Text textStyle="caption" color="fg.neutral-muted">
                설명
              </Text>
              <Text textStyle="bodySm">{motif.description}</Text>
            </VStack>
          )}
          {motif.tags.length > 0 && (
            <VStack gap="x1">
              <Text textStyle="caption" color="fg.neutral-muted">
                태그
              </Text>
              <TagGroup>
                {motif.tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </TagGroup>
            </VStack>
          )}
          {motif.color_slots.length > 0 && (
            <VStack gap="x1">
              <Text textStyle="caption" color="fg.neutral-muted">
                색상 슬롯 키
              </Text>
              <TagGroup>
                {motif.color_slots.map((slot) => (
                  <Tag key={slot}>{slot}</Tag>
                ))}
              </TagGroup>
            </VStack>
          )}
        </VStack>
      </Grid>
    </AdminCard>
  );
}

export function MotifsPage() {
  const [params, setParams] = useSearchParams();
  const parsed = parseAdminListQuery(params, { allowedTypes: SCOPES });
  const scope = isScope(parsed.type) ? parsed.type : undefined;
  const [sourceInput, setSourceInput] = useState("");
  const [source, setSource] = useState<string>();
  const [sourceError, setSourceError] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
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

  const replaceQuery = (changes: Partial<AdminListQuery>) => {
    setParams(serializeAdminListQuery({ ...parsed, ...changes }), {
      replace: true,
    });
  };
  const submitSource = (event: FormEvent) => {
    event.preventDefault();
    const value = sourceInput.trim();
    if (value === "") {
      setSource(undefined);
      setSourceError(undefined);
      setSelectedId(undefined);
      replaceQuery({ page: 1 });
      return;
    }
    if (!SAFE_SOURCE_PATTERN.test(value)) {
      setSourceError("소스는 영문·숫자와 . _ : -만 입력할 수 있습니다.");
      return;
    }
    setSource(value);
    setSourceError(undefined);
    setSelectedId(undefined);
    replaceQuery({ page: 1 });
  };

  const columns: readonly AdminTableColumn<MotifSummaryOut>[] = [
    {
      key: "subject",
      header: "Motif",
      render: (motif) => (
        <VStack gap="x0_5">
          <Text textStyle="labelSm">{motif.subject ?? motif.id}</Text>
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
    {
      key: "detail",
      header: "상세",
      render: (motif) => (
        <ActionButton
          variant={selectedId === motif.id ? "neutralWeak" : "ghost"}
          size="xsmall"
          aria-pressed={selectedId === motif.id}
          onClick={() => setSelectedId(motif.id)}
        >
          미리보기
        </ActionButton>
      ),
    },
  ];
  const totalPages = Math.max(
    1,
    Math.ceil((query.data?.total ?? 0) / parsed.limit),
  );

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
            onChange={(event) => {
              setSelectedId(undefined);
              replaceQuery({
                type:
                  event.currentTarget.value === "all"
                    ? undefined
                    : event.currentTarget.value,
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
              description="정확한 source 키로 필터합니다."
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
                  setSelectedId(undefined);
                  replaceQuery({ page: 1 });
                }}
              >
                소스 해제
              </ActionButton>
            )}
          </HStack>
        </HStack>
      </AdminCard>

      <AdminCard
        title="Motif 목록"
        description={`총 ${query.data?.total ?? 0}건`}
        action={
          <ActionButton
            variant="ghost"
            size="small"
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            새로고침
          </ActionButton>
        }
      >
        <VStack gap="x4" alignItems="stretch">
          <AdminTable
            label="Motif 목록"
            columns={columns}
            rows={query.data?.items}
            getRowKey={(row) => row.id}
            status={
              query.isLoading ? "loading" : query.isError ? "error" : "success"
            }
            total={query.data?.total}
            onRetry={() => void query.refetch()}
            emptyTitle="조건에 맞는 Motif가 없습니다"
          />
          <Pagination
            page={Math.min(parsed.page, totalPages)}
            totalPages={totalPages}
            onPageChange={(page) => {
              setSelectedId(undefined);
              replaceQuery({ page });
            }}
            label="Motif 목록 페이지"
          />
        </VStack>
      </AdminCard>

      {selectedId !== undefined && <MotifDetail motifId={selectedId} />}
    </VStack>
  );
}

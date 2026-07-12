import type { AdminClaimSummaryOut } from "@essesion/api-client";
import { adminListClaimsV2Options } from "@essesion/api-client/query";
import {
  ActionButton,
  HStack,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { formatDateTime } from "../../shared/lib/format";
import {
  parseAdminListQuery,
  serializeAdminListQuery,
} from "../../shared/lib/url-query";
import { AdminCard } from "../../shared/ui/admin-card";
import { FilterSelect } from "../../shared/ui/filter-select";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";
import {
  AdminTable,
  type AdminTableColumn,
} from "../../widgets/admin-table/admin-table";
import { Pagination } from "../../widgets/admin-table/pagination";

const CLAIM_TYPES = [
  { value: "all", label: "전체" },
  { value: "cancel", label: "취소" },
  { value: "return", label: "반품" },
  { value: "exchange", label: "교환" },
  { value: "token_refund", label: "토큰 환불" },
] as const;

const CLAIM_STATUSES = [
  "all",
  "접수",
  "처리중",
  "수거요청",
  "수거완료",
  "재발송",
  "완료",
  "거부",
] as const;

const CLAIM_SORTS = [
  "created_at",
  "updated_at",
  "claim_number",
  "status",
] as const;

type ClaimType = (typeof CLAIM_TYPES)[number]["value"];
type ClaimStatus = (typeof CLAIM_STATUSES)[number];
type ClaimSort = (typeof CLAIM_SORTS)[number];

function claimTypeLabel(type: string) {
  return CLAIM_TYPES.find((item) => item.value === type)?.label ?? type;
}

const columns: readonly AdminTableColumn<AdminClaimSummaryOut>[] = [
  {
    key: "claim_number",
    header: "클레임번호",
    sortable: true,
    render: (claim) => (
      <Link to={`/claims/${claim.id}`}>{claim.claim_number}</Link>
    ),
  },
  {
    key: "customer",
    header: "고객",
    render: (claim) => (
      <VStack gap="x0_5">
        <Text textStyle="bodySm">{claim.customer.name}</Text>
        <Text textStyle="caption" color="fg.neutral-muted">
          {claim.customer.email ?? "이메일 없음"}
        </Text>
      </VStack>
    ),
  },
  {
    key: "type",
    header: "유형",
    visibility: "medium",
    render: (claim) => claimTypeLabel(claim.type),
  },
  {
    key: "order",
    header: "주문",
    visibility: "medium",
    render: (claim) => (
      <Link to={`/orders/${claim.order_id}`}>{claim.order_number}</Link>
    ),
  },
  {
    key: "status",
    header: "상태",
    sortable: true,
    render: (claim) => <StatusBadge status={claim.status} />,
  },
  {
    key: "created_at",
    header: "접수일",
    sortable: true,
    visibility: "large",
    render: (claim) => formatDateTime(claim.created_at),
  },
];

export function ClaimsPage() {
  const [params, setParams] = useSearchParams();
  const parsed = parseAdminListQuery(params, {
    allowedSorts: CLAIM_SORTS,
    allowedStatuses: CLAIM_STATUSES,
    allowedTypes: CLAIM_TYPES.map((item) => item.value),
    defaultSort: "created_at",
    defaultDirection: "desc",
  });
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState<string>();
  const claimType = (parsed.type ?? "all") as ClaimType;
  const status = (parsed.status ?? "all") as ClaimStatus;
  const sort = (parsed.sort ?? "created_at") as ClaimSort;

  const query = useQuery({
    ...adminListClaimsV2Options({
      query: {
        claim_type: claimType,
        status,
        start_date: parsed.from,
        end_date: parsed.to,
        q: search,
        sort,
        direction: parsed.direction,
        limit: parsed.limit,
        offset: (parsed.page - 1) * parsed.limit,
      },
    }),
    placeholderData: keepPreviousData,
  });

  const replaceQuery = (changes: Partial<typeof parsed>) => {
    setParams(serializeAdminListQuery({ ...parsed, ...changes }), {
      replace: true,
    });
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const value = searchInput.trim();
    setSearch(value.length >= 2 ? value : undefined);
    replaceQuery({ page: 1 });
  };

  const totalPages = Math.max(
    1,
    Math.ceil((query.data?.total ?? 0) / parsed.limit),
  );

  return (
    <VStack gap="x6" alignItems="stretch">
      <RouteHeading
        title="클레임 관리"
        description="취소·반품·교환·토큰 환불 요청과 처리 상태를 조회합니다."
      />

      <AdminCard title="검색·필터">
        <VStack gap="x4" alignItems="stretch">
          <HStack
            as="form"
            gap="x2"
            align="flex-end"
            wrap
            onSubmit={submitSearch}
          >
            <TextField
              label="클레임번호 검색"
              description="2자 이상 입력해 주세요. 검색어는 URL에 저장하지 않습니다."
              value={searchInput}
              maxLength={64}
              onChange={(event) => setSearchInput(event.currentTarget.value)}
            />
            <ActionButton type="submit" variant="neutralOutline">
              검색
            </ActionButton>
            {search !== undefined && (
              <ActionButton
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearchInput("");
                  setSearch(undefined);
                }}
              >
                검색 초기화
              </ActionButton>
            )}
          </HStack>
          <HStack gap="x3" align="flex-end" wrap>
            <FilterSelect
              label="클레임 유형"
              value={claimType}
              options={CLAIM_TYPES}
              onChange={(event) =>
                replaceQuery({ type: event.currentTarget.value, page: 1 })
              }
            />
            <FilterSelect
              label="상태"
              value={status}
              options={CLAIM_STATUSES.map((value) => ({
                value,
                label: value === "all" ? "전체" : value,
              }))}
              onChange={(event) =>
                replaceQuery({ status: event.currentTarget.value, page: 1 })
              }
            />
            <TextField
              type="date"
              label="시작일 (KST)"
              value={parsed.from ?? ""}
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
              value={parsed.to ?? ""}
              onChange={(event) =>
                replaceQuery({
                  to: event.currentTarget.value || undefined,
                  page: 1,
                })
              }
            />
          </HStack>
        </VStack>
      </AdminCard>

      <AdminCard
        title="클레임 목록"
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
            label="클레임 목록"
            columns={columns}
            rows={query.data?.items}
            getRowKey={(row) => row.id}
            status={
              query.isLoading ? "loading" : query.isError ? "error" : "success"
            }
            total={query.data?.total}
            sort={{ key: sort, direction: parsed.direction }}
            onSort={({ key, direction }) =>
              replaceQuery({ sort: key, direction, page: 1 })
            }
            onRetry={() => void query.refetch()}
            emptyTitle="조건에 맞는 클레임이 없습니다"
          />
          <Pagination
            page={Math.min(parsed.page, totalPages)}
            totalPages={totalPages}
            onPageChange={(page) => replaceQuery({ page })}
            label="클레임 목록 페이지"
          />
        </VStack>
      </AdminCard>
    </VStack>
  );
}

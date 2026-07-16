import type {
  AdminInquirySummaryOut,
  PageAdminInquirySummaryOut,
} from "@essesion/api-client";
import { listAdminInquiries, searchAdminInquiries } from "@essesion/api-client";
import { Badge, HStack, Text, VStack } from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { formatDateTime } from "../../shared/lib/format";
import {
  parseAdminListQuery,
  serializeAdminListQuery,
} from "../../shared/lib/url-query";
import { useAdminListPageCorrection } from "../../shared/lib/use-admin-list-url-state";
import { AppliedFilterBar } from "../../shared/ui/applied-filter-bar";
import { CompactFilterToolbar } from "../../shared/ui/compact-filter-toolbar";
import { DateRangeFilters } from "../../shared/ui/date-range-filters";
import { FilterSelect } from "../../shared/ui/filter-select";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";
import { SubmittedMemorySearch } from "../../shared/ui/submitted-memory-search";
import type { AdminTableColumn } from "../../widgets/admin-table/admin-table";
import { PaginatedAdminTableCard } from "../../widgets/admin-table/paginated-admin-table-card";

const INQUIRY_STATUSES = ["all", "답변대기", "답변완료"] as const;
const INQUIRY_CATEGORIES = [
  "all",
  "일반",
  "상품",
  "수선",
  "주문제작",
  "샘플제작",
] as const;
const INQUIRY_SORTS = ["created_at", "updated_at", "status"] as const;
type InquiryStatus = (typeof INQUIRY_STATUSES)[number];
type InquiryCategory = (typeof INQUIRY_CATEGORIES)[number];
type InquirySort = (typeof INQUIRY_SORTS)[number];

const columns: readonly AdminTableColumn<AdminInquirySummaryOut>[] = [
  {
    key: "title",
    header: "문의",
    render: (inquiry) => (
      <VStack gap="x0_5">
        <HStack gap="x2" wrap>
          <Link to={`/inquiries/${inquiry.id}`}>{inquiry.title}</Link>
          {inquiry.is_secret ? <Badge>비밀글</Badge> : null}
        </HStack>
        <Text textStyle="caption" color="fg.neutral-muted">
          {inquiry.customer?.name ?? "탈퇴/비회원 고객"}
        </Text>
      </VStack>
    ),
  },
  { key: "category", header: "분류", render: (inquiry) => inquiry.category },
  {
    key: "product",
    header: "관련 상품",
    visibility: "medium",
    render: (inquiry) => inquiry.product?.name ?? "-",
  },
  {
    key: "status",
    header: "상태",
    sortable: true,
    render: (inquiry) => <StatusBadge status={inquiry.status} />,
  },
  {
    key: "created_at",
    header: "문의일",
    sortable: true,
    visibility: "large",
    render: (inquiry) => formatDateTime(inquiry.created_at),
  },
];

export function InquiriesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const parsed = parseAdminListQuery(params, {
    allowedSorts: INQUIRY_SORTS,
    allowedStatuses: INQUIRY_STATUSES,
    allowedTypes: INQUIRY_CATEGORIES,
    defaultSort: "created_at",
    defaultDirection: "desc",
  });
  const [search, setSearch] = useState<string>();
  const [searchResetKey, setSearchResetKey] = useState(0);
  const status = (parsed.status ?? "all") as InquiryStatus;
  const category = (parsed.type ?? "all") as InquiryCategory;
  const [draftStatus, setDraftStatus] = useState<InquiryStatus>(status);
  const [draftCategory, setDraftCategory] = useState<InquiryCategory>(category);
  const [draftFrom, setDraftFrom] = useState(parsed.from);
  const [draftTo, setDraftTo] = useState(parsed.to);
  const sort = (parsed.sort ?? "created_at") as InquirySort;
  const offset = (parsed.page - 1) * parsed.limit;
  const requestParams = {
    status,
    category,
    sort,
    direction: parsed.direction,
    start_date: parsed.from,
    end_date: parsed.to,
    limit: parsed.limit,
    offset,
  };

  const query = useQuery<PageAdminInquirySummaryOut>({
    queryKey: ["admin-inquiries", { ...requestParams, search }],
    queryFn: async ({ signal }) => {
      const { data } = search
        ? await searchAdminInquiries({
            body: { ...requestParams, q: search },
            signal,
            throwOnError: true,
          })
        : await listAdminInquiries({
            query: requestParams,
            signal,
            throwOnError: true,
          });
      return data;
    },
    placeholderData: keepPreviousData,
  });

  const replaceQuery = (changes: Partial<typeof parsed>) => {
    setParams(serializeAdminListQuery({ ...parsed, ...changes }), {
      replace: true,
    });
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
        title="문의 관리"
        description="고객·상품 문맥을 확인하고 중복 없이 답변합니다. 검색어는 URL에 남기지 않습니다."
      />
      <PaginatedAdminTableCard
        title="문의 목록"
        label="문의 목록"
        columns={columns}
        rows={query.data?.items}
        getRowKey={(row) => row.id}
        onRowClick={(row) => navigate(`/inquiries/${row.id}`)}
        status={
          query.isLoading || query.isPlaceholderData
            ? "loading"
            : query.isError
              ? "error"
              : "success"
        }
        total={query.data?.total}
        limit={parsed.limit}
        sort={{ key: sort, direction: parsed.direction }}
        onSort={({ key, direction }) =>
          replaceQuery({ sort: key, direction, page: 1 })
        }
        refreshing={query.isFetching}
        onRefresh={() => void query.refetch()}
        onRetry={() => void query.refetch()}
        emptyTitle="조건에 맞는 문의가 없습니다"
        page={Math.min(parsed.page, totalPages)}
        totalPages={totalPages}
        onPageChange={(page) => replaceQuery({ page })}
        paginationLabel="문의 목록 페이지"
        toolbar={
          <VStack gap="x3" alignItems="stretch">
            <CompactFilterToolbar
              primaryControls={
                <SubmittedMemorySearch
                  label="제목·내용 검색"
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
                    label="답변 상태"
                    presentation="inline"
                    value={draftStatus}
                    options={INQUIRY_STATUSES.map((value) => ({
                      value,
                      label: value === "all" ? "전체" : value,
                    }))}
                    onValueChange={(value) =>
                      setDraftStatus(value as InquiryStatus)
                    }
                  />
                  <FilterSelect
                    label="분류"
                    presentation="inline"
                    value={draftCategory}
                    options={INQUIRY_CATEGORIES.map((value) => ({
                      value,
                      label: value === "all" ? "전체" : value,
                    }))}
                    onValueChange={(value) =>
                      setDraftCategory(value as InquiryCategory)
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
                Number(status !== "all") +
                Number(category !== "all") +
                Number(parsed.from !== undefined) +
                Number(parsed.to !== undefined)
              }
              secondaryTitle="문의 상세 필터"
              secondaryDescription="답변 상태, 문의 분류, 문의일을 한 번에 적용합니다."
              onOpenSecondaryFilters={() => {
                setDraftStatus(status);
                setDraftCategory(category);
                setDraftFrom(parsed.from);
                setDraftTo(parsed.to);
              }}
              onApplySecondaryFilters={() => {
                replaceQuery({
                  status: draftStatus === "all" ? undefined : draftStatus,
                  type: draftCategory === "all" ? undefined : draftCategory,
                  from: draftFrom,
                  to: draftTo,
                  page: 1,
                });
              }}
              onCancelSecondaryFilters={() => {
                setDraftStatus(status);
                setDraftCategory(category);
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
                status !== "all" && {
                  key: "status",
                  label: `상태: ${status}`,
                  onRemove: () => replaceQuery({ status: undefined, page: 1 }),
                },
                category !== "all" && {
                  key: "category",
                  label: `분류: ${category}`,
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
              ]}
              onReset={() => {
                setSearch(undefined);
                setSearchResetKey((current) => current + 1);
                replaceQuery({
                  page: 1,
                  limit: 20,
                  sort: "created_at",
                  direction: "desc",
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

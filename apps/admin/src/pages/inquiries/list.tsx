import type {
  AdminInquirySummaryOut,
  PageAdminInquirySummaryOut,
} from "@essesion/api-client";
import { listAdminInquiries, searchAdminInquiries } from "@essesion/api-client";
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

const INQUIRY_STATUSES = ["all", "답변대기", "답변완료"] as const;
const INQUIRY_CATEGORIES = ["all", "일반", "상품", "수선", "주문제작"] as const;
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
        <Link to={`/inquiries/${inquiry.id}`}>{inquiry.title}</Link>
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
  const [params, setParams] = useSearchParams();
  const parsed = parseAdminListQuery(params, {
    allowedSorts: INQUIRY_SORTS,
    allowedStatuses: INQUIRY_STATUSES,
    allowedTypes: INQUIRY_CATEGORIES,
    defaultSort: "created_at",
    defaultDirection: "desc",
  });
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState<string>();
  const status = (parsed.status ?? "all") as InquiryStatus;
  const category = (parsed.type ?? "all") as InquiryCategory;
  const sort = (parsed.sort ?? "created_at") as InquirySort;
  const offset = (parsed.page - 1) * parsed.limit;
  const requestParams = {
    status,
    category,
    sort,
    direction: parsed.direction,
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
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const value = searchInput.trim();
    if (value.length < 2) return;
    setSearch(value);
    replaceQuery({ page: 1 });
  };
  const totalPages = Math.max(
    1,
    Math.ceil((query.data?.total ?? 0) / parsed.limit),
  );

  return (
    <VStack gap="x6" alignItems="stretch">
      <RouteHeading
        title="문의 관리"
        description="고객·상품 문맥을 확인하고 중복 없이 답변합니다. 검색어는 URL에 남기지 않습니다."
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
              label="제목·내용 검색"
              description="2자 이상 입력해 주세요. 요청 본문으로만 전송됩니다."
              minLength={2}
              maxLength={100}
              value={searchInput}
              onChange={(event) => setSearchInput(event.currentTarget.value)}
            />
            <ActionButton
              type="submit"
              variant="neutralOutline"
              disabled={searchInput.trim().length < 2}
            >
              검색
            </ActionButton>
            {search && (
              <ActionButton
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearchInput("");
                  setSearch(undefined);
                  replaceQuery({ page: 1 });
                }}
              >
                검색 초기화
              </ActionButton>
            )}
          </HStack>
          <HStack gap="x3" align="flex-end" wrap>
            <FilterSelect
              label="답변 상태"
              value={status}
              options={INQUIRY_STATUSES.map((value) => ({
                value,
                label: value === "all" ? "전체" : value,
              }))}
              onChange={(event) =>
                replaceQuery({ status: event.currentTarget.value, page: 1 })
              }
            />
            <FilterSelect
              label="분류"
              value={category}
              options={INQUIRY_CATEGORIES.map((value) => ({
                value,
                label: value === "all" ? "전체" : value,
              }))}
              onChange={(event) =>
                replaceQuery({ type: event.currentTarget.value, page: 1 })
              }
            />
          </HStack>
        </VStack>
      </AdminCard>
      <AdminCard
        title="문의 목록"
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
            label="문의 목록"
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
            emptyTitle="조건에 맞는 문의가 없습니다"
          />
          <Pagination
            page={Math.min(parsed.page, totalPages)}
            totalPages={totalPages}
            onPageChange={(page) => replaceQuery({ page })}
            label="문의 목록 페이지"
          />
        </VStack>
      </AdminCard>
    </VStack>
  );
}

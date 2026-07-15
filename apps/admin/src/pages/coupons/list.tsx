import type { AdminCouponOut } from "@essesion/api-client";
import { listAdminCouponsOptions } from "@essesion/api-client/query";
import { ActionButton, HStack, Text, VStack } from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";

import { formatDate, formatMoney } from "../../shared/lib/format";
import {
  useAdminListPageCorrection,
  useAdminListUrlState,
} from "../../shared/lib/use-admin-list-url-state";
import { AdminCard } from "../../shared/ui/admin-card";
import { FilterSelect } from "../../shared/ui/filter-select";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";
import type { AdminTableColumn } from "../../widgets/admin-table/admin-table";
import { PaginatedAdminTableCard } from "../../widgets/admin-table/paginated-admin-table-card";

const COUPON_STATUSES = ["all", "active", "inactive"] as const;
const COUPON_SORTS = ["created_at", "expiry_date", "name"] as const;

type CouponStatus = (typeof COUPON_STATUSES)[number];
type CouponSort = (typeof COUPON_SORTS)[number];

function discountLabel(coupon: AdminCouponOut) {
  return coupon.discount_type === "percentage"
    ? `${Number(coupon.discount_value).toLocaleString("ko-KR")}%`
    : formatMoney(coupon.discount_value);
}

const columns: readonly AdminTableColumn<AdminCouponOut>[] = [
  {
    key: "name",
    header: "쿠폰",
    sortable: true,
    render: (coupon) => (
      <VStack gap="x0_5">
        <Link to={`/coupons/${coupon.id}`}>{coupon.name}</Link>
        <Text textStyle="caption" color="fg.neutral-muted">
          {coupon.display_name ?? "고객 표시 이름 없음"}
        </Text>
      </VStack>
    ),
  },
  {
    key: "discount",
    header: "할인 조건",
    render: (coupon) => discountLabel(coupon),
  },
  {
    key: "maximum",
    header: "최대 할인",
    visibility: "medium",
    render: (coupon) => formatMoney(coupon.max_discount_amount),
  },
  {
    key: "expiry_date",
    header: "만료일",
    sortable: true,
    render: (coupon) => formatDate(coupon.expiry_date),
  },
  {
    key: "status",
    header: "상태",
    render: (coupon) => (
      <StatusBadge status={coupon.is_active ? "active" : "inactive"} />
    ),
  },
  {
    key: "issued",
    header: "발급",
    align: "end",
    visibility: "large",
    render: (coupon) =>
      `${coupon.active_issued_count.toLocaleString("ko-KR")} / ${coupon.issued_count.toLocaleString("ko-KR")}건`,
  },
];

export function CouponsPage() {
  const navigate = useNavigate();
  const { query: parsed, replaceQuery } = useAdminListUrlState({
    allowedSorts: COUPON_SORTS,
    allowedStatuses: COUPON_STATUSES,
    defaultSort: "created_at",
  });
  const status = (parsed.status ?? "all") as CouponStatus;
  const sort = (parsed.sort ?? "created_at") as CouponSort;
  const query = useQuery({
    ...listAdminCouponsOptions({
      query: {
        status,
        sort,
        direction: parsed.direction,
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
          title="쿠폰 관리"
          description="쿠폰 정의와 발급 현황을 조회합니다. 목록 상태에는 비민감 필터만 저장합니다."
        />
        <ActionButton onClick={() => navigate("/coupons/new")}>
          새 쿠폰 등록
        </ActionButton>
      </HStack>

      <AdminCard title="필터">
        <HStack gap="x3" align="flex-end" wrap>
          <FilterSelect
            label="활성 상태"
            value={status}
            options={[
              { value: "all", label: "전체" },
              { value: "active", label: "활성" },
              { value: "inactive", label: "비활성" },
            ]}
            onValueChange={(value) => replaceQuery({ status: value, page: 1 })}
          />
          <FilterSelect
            label="정렬"
            value={sort}
            options={[
              { value: "created_at", label: "등록일" },
              { value: "expiry_date", label: "만료일" },
              { value: "name", label: "이름" },
            ]}
            onValueChange={(value) => replaceQuery({ sort: value, page: 1 })}
          />
        </HStack>
      </AdminCard>

      <PaginatedAdminTableCard
        title="쿠폰 목록"
        description={`총 ${query.data?.total ?? 0}개`}
        label="쿠폰 목록"
        columns={columns}
        rows={query.data?.items}
        getRowKey={(coupon) => coupon.id}
        status={
          query.isLoading ? "loading" : query.isError ? "error" : "success"
        }
        total={query.data?.total}
        sort={{ key: sort, direction: parsed.direction }}
        onSort={({ key, direction }) =>
          replaceQuery({ sort: key, direction, page: 1 })
        }
        refreshing={query.isFetching}
        onRefresh={() => void query.refetch()}
        emptyTitle="조건에 맞는 쿠폰이 없습니다"
        emptyDescription="필터를 바꾸거나 새 쿠폰을 등록해 주세요."
        page={Math.min(parsed.page, totalPages)}
        totalPages={totalPages}
        onPageChange={(page) => replaceQuery({ page })}
        paginationLabel="쿠폰 목록 페이지"
      />
    </VStack>
  );
}

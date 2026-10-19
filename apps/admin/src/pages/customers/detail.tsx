import type {
  AdminCustomerCouponOut,
  AdminCustomerOrderOut,
} from "@essesion/api-client";
import {
  getAdminCustomerOptions,
  listAdminCustomerCouponsOptions,
  listAdminCustomerOrdersOptions,
} from "@essesion/api-client/query";
import {
  ActionButton,
  ContentPlaceholder,
  formatPhoneNumber,
  HStack,
  TabContent,
  TabList,
  Tabs,
  TabTrigger,
  VStack,
} from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import {
  formatDate,
  formatDateTime,
  formatIdentifier,
  formatMoney,
  formatOrderType,
} from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { DetailList } from "../../shared/ui/detail-list";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";
import {
  AdminTable,
  type AdminTableColumn,
} from "../../widgets/admin-table/admin-table";
import { Pagination } from "../../widgets/admin-table/pagination";

const PAGE_SIZE = 5;
const CUSTOMER_TABS = ["overview", "orders", "coupons"] as const;
type CustomerTab = (typeof CUSTOMER_TABS)[number];

const orderColumns: readonly AdminTableColumn<AdminCustomerOrderOut>[] = [
  {
    key: "number",
    header: "주문번호",
    render: (order) => (
      <Link to={`/orders/${order.id}`}>{order.order_number}</Link>
    ),
  },
  {
    key: "type",
    header: "유형",
    render: (order) => formatOrderType(order.order_type),
  },
  {
    key: "amount",
    header: "주문 금액",
    align: "end",
    render: (order) => formatMoney(order.total_price),
  },
  {
    key: "status",
    header: "상태",
    render: (order) => <StatusBadge status={order.status} />,
  },
  {
    key: "created",
    header: "주문일",
    visibility: "large",
    render: (order) => formatDateTime(order.created_at),
  },
];

const couponColumns: readonly AdminTableColumn<AdminCustomerCouponOut>[] = [
  {
    key: "name",
    header: "쿠폰",
    render: (coupon) => (
      <Link to={`/coupons/${coupon.coupon_id}`}>
        {coupon.coupon_display_name ?? coupon.coupon_name}
      </Link>
    ),
  },
  {
    key: "status",
    header: "상태",
    render: (coupon) => <StatusBadge status={coupon.status} />,
  },
  {
    key: "issued",
    header: "발급일",
    render: (coupon) => formatDateTime(coupon.issued_at),
  },
  {
    key: "expires",
    header: "만료일",
    visibility: "medium",
    render: (coupon) => formatDateTime(coupon.expires_at),
  },
];

function pageFrom(params: URLSearchParams, key: string) {
  const value = params.get(key);
  if (value === null || !/^\d+$/.test(value)) return 1;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function pageCount(total: number | undefined) {
  return Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE));
}

function customerTabFrom(params: URLSearchParams): CustomerTab {
  const value = params.get("tab");
  return CUSTOMER_TABS.includes(value as CustomerTab)
    ? (value as CustomerTab)
    : "overview";
}

function booleanLabel(value: boolean) {
  return value ? "동의" : "미동의";
}

export function CustomerDetailPage() {
  const navigate = useNavigate();
  const { userId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = customerTabFrom(params);
  const ordersPage = pageFrom(params, "ordersPage");
  const couponsPage = pageFrom(params, "couponsPage");

  const detail = useQuery({
    ...getAdminCustomerOptions({ path: { user_id: userId } }),
    enabled: userId !== "",
  });
  const orders = useQuery({
    ...listAdminCustomerOrdersOptions({
      path: { user_id: userId },
      query: { limit: PAGE_SIZE, offset: (ordersPage - 1) * PAGE_SIZE },
    }),
    enabled: userId !== "",
  });
  const coupons = useQuery({
    ...listAdminCustomerCouponsOptions({
      path: { user_id: userId },
      query: { limit: PAGE_SIZE, offset: (couponsPage - 1) * PAGE_SIZE },
    }),
    enabled: userId !== "",
  });

  useEffect(() => {
    const next = new URLSearchParams(params);
    let changed = false;
    const clampPage = (
      key: "ordersPage" | "couponsPage",
      currentPage: number,
      total: number | undefined,
    ) => {
      if (total === undefined) return;
      const lastPage = pageCount(total);
      if (currentPage <= lastPage) return;
      if (lastPage === 1) next.delete(key);
      else next.set(key, String(lastPage));
      changed = true;
    };

    clampPage("ordersPage", ordersPage, orders.data?.total);
    clampPage("couponsPage", couponsPage, coupons.data?.total);
    if (changed) setParams(next, { replace: true });
  }, [
    coupons.data?.total,
    couponsPage,
    orders.data?.total,
    ordersPage,
    params,
    setParams,
  ]);

  const setPage = (key: "ordersPage" | "couponsPage", page: number) => {
    const next = new URLSearchParams(params);
    if (page <= 1) next.delete(key);
    else next.set(key, String(page));
    setParams(next, { replace: true });
  };

  const setTab = (nextTab: string) => {
    const next = new URLSearchParams(params);
    if (nextTab === "overview") next.delete("tab");
    else next.set("tab", nextTab);
    setParams(next, { replace: true });
  };

  const refreshAll = () => {
    void Promise.all([detail.refetch(), orders.refetch(), coupons.refetch()]);
  };

  if (detail.isLoading) {
    return (
      <VStack gap="x6" alignItems="stretch" aria-busy="true">
        <RouteHeading title="고객 상세" />
        <ContentPlaceholder title="고객 정보를 불러오고 있습니다" />
      </VStack>
    );
  }

  if (detail.isError || detail.data === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading title="고객 상세" />
        <ContentPlaceholder
          title="고객 정보를 불러오지 못했습니다"
          description="주소를 확인하거나 다시 시도해 주세요."
          action={
            <ActionButton onClick={() => void detail.refetch()}>
              다시 시도
            </ActionButton>
          }
        />
      </VStack>
    );
  }

  const customer = detail.data;
  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading title={customer.name} />
        <ActionButton
          variant="ghost"
          loading={detail.isFetching || orders.isFetching || coupons.isFetching}
          onClick={refreshAll}
        >
          새로고침
        </ActionButton>
      </HStack>

      <Tabs value={tab} onValueChange={setTab}>
        <TabList aria-label="고객 상세 메뉴">
          <TabTrigger value="overview">개요</TabTrigger>
          <TabTrigger value="orders">주문</TabTrigger>
          <TabTrigger value="coupons">쿠폰</TabTrigger>
        </TabList>

        <TabContent value="overview">
          <VStack gap="x5" pt="x5" alignItems="stretch">
            <AdminCard title="고객 정보">
              <DetailList
                items={[
                  {
                    label: "계정 상태",
                    value: customer.is_active ? "활성" : "비활성",
                  },
                  { label: "이메일", value: formatIdentifier(customer.email) },
                  {
                    label: "전화번호",
                    value: formatIdentifier(
                      customer.phone ? formatPhoneNumber(customer.phone) : null,
                    ),
                  },
                  {
                    label: "전화 인증",
                    value: customer.phone_verified ? "완료" : "미완료",
                  },
                  { label: "생년월일", value: formatDate(customer.birth) },
                  {
                    label: "가입일",
                    value: formatDateTime(customer.created_at),
                  },
                  {
                    label: "최근 수정",
                    value: formatDateTime(customer.updated_at),
                  },
                  {
                    label: "알림 수신",
                    value: booleanLabel(customer.notification_enabled),
                  },
                  {
                    label: "알림 동의",
                    value: booleanLabel(customer.notification_consent),
                  },
                  {
                    label: "카카오·SMS 마케팅",
                    value: booleanLabel(customer.marketing_kakao_sms_consent),
                  },
                ]}
              />
            </AdminCard>
          </VStack>
        </TabContent>

        <TabContent value="orders">
          <VStack pt="x5" alignItems="stretch">
            <AdminCard title="주문 이력">
              <VStack gap="x4" alignItems="stretch">
                <AdminTable
                  label="고객 주문 이력"
                  columns={orderColumns}
                  rows={orders.data?.items}
                  getRowKey={(row) => row.id}
                  onRowClick={(row) => navigate(`/orders/${row.id}`)}
                  status={
                    orders.isLoading
                      ? "loading"
                      : orders.isError
                        ? "error"
                        : "success"
                  }
                  total={orders.data?.total}
                  onRetry={() => void orders.refetch()}
                />
                <Pagination
                  page={Math.min(ordersPage, pageCount(orders.data?.total))}
                  totalPages={pageCount(orders.data?.total)}
                  total={orders.data?.total}
                  limit={PAGE_SIZE}
                  onPageChange={(page) => setPage("ordersPage", page)}
                  label="고객 주문 이력 페이지"
                />
              </VStack>
            </AdminCard>
          </VStack>
        </TabContent>

        <TabContent value="coupons">
          <VStack pt="x5" alignItems="stretch">
            <AdminCard title="쿠폰 이력">
              <VStack gap="x4" alignItems="stretch">
                <AdminTable
                  label="고객 쿠폰 이력"
                  columns={couponColumns}
                  rows={coupons.data?.items}
                  getRowKey={(row) => row.id}
                  onRowClick={(row) => navigate(`/coupons/${row.coupon_id}`)}
                  status={
                    coupons.isLoading
                      ? "loading"
                      : coupons.isError
                        ? "error"
                        : "success"
                  }
                  total={coupons.data?.total}
                  onRetry={() => void coupons.refetch()}
                />
                <Pagination
                  page={Math.min(couponsPage, pageCount(coupons.data?.total))}
                  totalPages={pageCount(coupons.data?.total)}
                  total={coupons.data?.total}
                  limit={PAGE_SIZE}
                  onPageChange={(page) => setPage("couponsPage", page)}
                  label="고객 쿠폰 이력 페이지"
                />
              </VStack>
            </AdminCard>
          </VStack>
        </TabContent>
      </Tabs>
    </VStack>
  );
}

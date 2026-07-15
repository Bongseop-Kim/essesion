import type {
  AdminCustomerCouponOut,
  AdminCustomerOrderOut,
  AdminCustomerTokenOut,
} from "@essesion/api-client";
import {
  adminManageTokensMutation,
  getAdminCustomerOptions,
  getAdminCustomerQueryKey,
  listAdminCustomerCouponsOptions,
  listAdminCustomerOrdersOptions,
  listAdminCustomerTokensOptions,
  listAdminCustomerTokensQueryKey,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Callout,
  ContentPlaceholder,
  Grid,
  HStack,
  snackbar,
  Text,
  TextAreaField,
  TextField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import {
  formatDate,
  formatDateTime,
  formatIdentifier,
  formatMoney,
  getErrorMessage,
} from "../../shared/lib/format";
import { useAdminSession } from "../../shared/session/admin-session";
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

const orderColumns: readonly AdminTableColumn<AdminCustomerOrderOut>[] = [
  {
    key: "number",
    header: "주문번호",
    render: (order) => (
      <Link to={`/orders/${order.id}`}>{order.order_number}</Link>
    ),
  },
  { key: "type", header: "유형", render: (order) => order.order_type },
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

const tokenColumns: readonly AdminTableColumn<AdminCustomerTokenOut>[] = [
  {
    key: "amount",
    header: "증감",
    align: "end",
    render: (token) =>
      `${token.amount > 0 ? "+" : ""}${token.amount.toLocaleString("ko-KR")}개`,
  },
  { key: "class", header: "구분", render: (token) => token.token_class },
  {
    key: "description",
    header: "사유",
    render: (token) => token.description ?? "-",
  },
  {
    key: "created",
    header: "처리 시각",
    visibility: "medium",
    render: (token) => formatDateTime(token.created_at),
  },
  {
    key: "expires",
    header: "만료 시각",
    visibility: "large",
    render: (token) => formatDateTime(token.expires_at),
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

function booleanLabel(value: boolean) {
  return value ? "동의" : "미동의";
}

export function CustomerDetailPage() {
  const { userId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { state } = useAdminSession();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const ordersPage = pageFrom(params, "ordersPage");
  const couponsPage = pageFrom(params, "couponsPage");
  const tokensPage = pageFrom(params, "tokensPage");

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
  const tokens = useQuery({
    ...listAdminCustomerTokensOptions({
      path: { user_id: userId },
      query: { limit: PAGE_SIZE, offset: (tokensPage - 1) * PAGE_SIZE },
    }),
    enabled: userId !== "",
  });

  const canAdjustTokens =
    state.status === "authenticated" && state.session.role === "admin";
  const amountValue = Number(amount);
  const adjustmentValid =
    Number.isSafeInteger(amountValue) &&
    amountValue !== 0 &&
    reason.trim().length >= 3;

  const mutation = useMutation({
    ...adminManageTokensMutation(),
    onSuccess: async (result) => {
      snackbar(
        `토큰 조정을 완료했습니다. 현재 잔액 ${result.new_balance.toLocaleString("ko-KR")}개`,
      );
      setAmount("");
      setReason("");
      setOperationId(crypto.randomUUID());
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getAdminCustomerQueryKey({ path: { user_id: userId } }),
        }),
        queryClient.invalidateQueries({
          queryKey: listAdminCustomerTokensQueryKey({
            path: { user_id: userId },
          }),
        }),
      ]);
    },
  });

  const setPage = (
    key: "ordersPage" | "couponsPage" | "tokensPage",
    page: number,
  ) => {
    const next = new URLSearchParams(params);
    if (page <= 1) next.delete(key);
    else next.set(key, String(page));
    setParams(next, { replace: true });
  };

  const refreshAll = () => {
    void Promise.all([
      detail.refetch(),
      orders.refetch(),
      coupons.refetch(),
      tokens.refetch(),
    ]);
  };

  const submitAdjustment = (event: FormEvent) => {
    event.preventDefault();
    if (canAdjustTokens && adjustmentValid) setConfirmOpen(true);
  };

  const runAdjustment = () => {
    if (!canAdjustTokens || !adjustmentValid || mutation.isPending) return;
    mutation.mutate({
      body: {
        operation_id: operationId,
        user_id: userId,
        amount: amountValue,
        description: reason.trim(),
      },
    });
  };

  if (detail.isLoading) {
    return (
      <VStack gap="x6" alignItems="stretch" aria-busy="true">
        <RouteHeading
          title="고객 상세"
          description="고객 정보를 불러오고 있습니다."
        />
        <ContentPlaceholder title="고객 정보를 불러오고 있습니다" />
      </VStack>
    );
  }

  if (detail.isError || detail.data === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading
          title="고객 상세"
          description="고객과 운영 이력을 확인합니다."
        />
        <ContentPlaceholder
          title="고객 정보를 불러오지 못했습니다"
          description="고객 ID를 확인하거나 다시 시도해 주세요."
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
        <RouteHeading
          title={customer.name}
          description="고객 프로필과 주문·쿠폰·토큰 이력을 각각 조회합니다."
        />
        <ActionButton
          variant="ghost"
          loading={
            detail.isFetching ||
            orders.isFetching ||
            coupons.isFetching ||
            tokens.isFetching
          }
          onClick={refreshAll}
        >
          새로고침
        </ActionButton>
      </HStack>

      <AdminCard title="고객 정보">
        <DetailList
          items={[
            {
              label: "계정 상태",
              value: customer.is_active ? "활성" : "비활성",
            },
            { label: "이메일", value: formatIdentifier(customer.email) },
            { label: "전화번호", value: formatIdentifier(customer.phone) },
            {
              label: "전화 인증",
              value: customer.phone_verified ? "완료" : "미완료",
            },
            { label: "생년월일", value: formatDate(customer.birth) },
            { label: "가입일", value: formatDateTime(customer.created_at) },
            { label: "최근 수정", value: formatDateTime(customer.updated_at) },
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

      <Grid columns={{ base: 1, md: 3 }} gap="x3">
        <AdminCard title="전체 토큰">
          <Text textStyle="title2">
            {customer.token_balance.toLocaleString("ko-KR")}개
          </Text>
        </AdminCard>
        <AdminCard title="유료 토큰">
          <Text textStyle="title2">
            {customer.paid_token_balance.toLocaleString("ko-KR")}개
          </Text>
        </AdminCard>
        <AdminCard title="보너스 토큰">
          <Text textStyle="title2">
            {customer.bonus_token_balance.toLocaleString("ko-KR")}개
          </Text>
        </AdminCard>
      </Grid>

      <AdminCard
        title="토큰 지급·회수"
        description={`operation ${operationId}`}
      >
        {!canAdjustTokens ? (
          <Callout
            tone="informative"
            title="조회 전용 권한"
            description="토큰 지급·회수는 admin 역할만 실행할 수 있습니다."
          />
        ) : (
          <VStack
            as="form"
            gap="x4"
            alignItems="stretch"
            onSubmit={submitAdjustment}
          >
            <HStack gap="x3" align="flex-end" wrap>
              <TextField
                type="number"
                step={1}
                label="조정 수량"
                description="지급은 양수, 회수는 음수로 입력합니다."
                value={amount}
                disabled={mutation.isPending}
                onChange={(event) => setAmount(event.currentTarget.value)}
              />
              <TextAreaField
                label="처리 사유"
                required
                maxLength={500}
                value={reason}
                errorMessage={
                  reason !== "" && reason.trim().length < 3
                    ? "3자 이상 입력해 주세요."
                    : undefined
                }
                disabled={mutation.isPending}
                onChange={(event) => setReason(event.currentTarget.value)}
              />
            </HStack>
            {mutation.isError && (
              <Callout
                role="alert"
                tone="critical"
                title="토큰을 조정하지 못했습니다"
                description={getErrorMessage(
                  mutation.error,
                  "잔액과 계정 상태를 확인한 뒤 다시 시도해 주세요.",
                )}
              />
            )}
            <ActionButton
              type="submit"
              loading={mutation.isPending}
              disabled={!adjustmentValid}
            >
              조정 내용 확인
            </ActionButton>
          </VStack>
        )}
      </AdminCard>

      <AdminCard
        title="주문 이력"
        description={`총 ${orders.data?.total ?? 0}건`}
      >
        <VStack gap="x4" alignItems="stretch">
          <AdminTable
            label="고객 주문 이력"
            columns={orderColumns}
            rows={orders.data?.items}
            getRowKey={(row) => row.id}
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
            onPageChange={(page) => setPage("ordersPage", page)}
            label="고객 주문 이력 페이지"
          />
        </VStack>
      </AdminCard>

      <AdminCard
        title="쿠폰 이력"
        description={`총 ${coupons.data?.total ?? 0}건`}
      >
        <VStack gap="x4" alignItems="stretch">
          <AdminTable
            label="고객 쿠폰 이력"
            columns={couponColumns}
            rows={coupons.data?.items}
            getRowKey={(row) => row.id}
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
            onPageChange={(page) => setPage("couponsPage", page)}
            label="고객 쿠폰 이력 페이지"
          />
        </VStack>
      </AdminCard>

      <AdminCard
        title="토큰 원장"
        description={`총 ${tokens.data?.total ?? 0}건`}
      >
        <VStack gap="x4" alignItems="stretch">
          <AdminTable
            label="고객 토큰 원장"
            columns={tokenColumns}
            rows={tokens.data?.items}
            getRowKey={(row) => row.id}
            status={
              tokens.isLoading
                ? "loading"
                : tokens.isError
                  ? "error"
                  : "success"
            }
            total={tokens.data?.total}
            onRetry={() => void tokens.refetch()}
          />
          <Pagination
            page={Math.min(tokensPage, pageCount(tokens.data?.total))}
            totalPages={pageCount(tokens.data?.total)}
            onPageChange={(page) => setPage("tokensPage", page)}
            label="고객 토큰 원장 페이지"
          />
        </VStack>
      </AdminCard>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={amountValue > 0 ? "토큰을 지급할까요?" : "토큰을 회수할까요?"}
        description={`${amountValue.toLocaleString("ko-KR")}개 · ${reason.trim()}`}
        primaryActionProps={{
          children: amountValue > 0 ? "지급" : "회수",
          variant: amountValue > 0 ? "brandSolid" : "criticalSolid",
          loading: mutation.isPending,
          onClick: runAdjustment,
        }}
        secondaryActionProps={{ children: "취소" }}
      />
    </VStack>
  );
}

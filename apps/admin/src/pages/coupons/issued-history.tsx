import type { IssuedCouponOut } from "@essesion/api-client";
import {
  listIssuedCouponsOptions,
  revokeCouponsMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Callout,
  Checkbox,
  snackbar,
  Text,
  TextAreaField,
  VStack,
} from "@essesion/shared";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";

import {
  formatDateTime,
  formatMoney,
  getErrorMessage,
} from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { FilterSelect } from "../../shared/ui/filter-select";
import { StatusBadge } from "../../shared/ui/status-badge";
import {
  AdminTable,
  type AdminTableColumn,
} from "../../widgets/admin-table/admin-table";
import { Pagination } from "../../widgets/admin-table/pagination";

const ISSUED_STATUSES = [
  "all",
  "active",
  "reserved",
  "used",
  "expired",
  "revoked",
] as const;

type IssuedStatus = (typeof ISSUED_STATUSES)[number];

function issuedStatusLabel(status: IssuedStatus) {
  return (
    {
      all: "전체",
      active: "활성",
      reserved: "예약",
      used: "사용 완료",
      expired: "만료",
      revoked: "회수",
    } satisfies Record<IssuedStatus, string>
  )[status];
}

export type CouponIssuedHistoryProps = {
  couponId: string;
  canManage: boolean;
};

function snapshotString(
  snapshot: IssuedCouponOut["terms_snapshot"],
  key: string,
) {
  if (snapshot === null) return undefined;
  const value = snapshot[key];
  return typeof value === "string" ? value : undefined;
}

function snapshotLabel(issuance: IssuedCouponOut) {
  const type = snapshotString(issuance.terms_snapshot, "discount_type");
  const value = snapshotString(issuance.terms_snapshot, "discount_value");
  const maximum = snapshotString(
    issuance.terms_snapshot,
    "max_discount_amount",
  );
  const expiry = snapshotString(issuance.terms_snapshot, "expiry_date");
  if (type === undefined || value === undefined) return "이전 조건 정보 없음";
  const discount =
    type === "percentage" ? `${Number(value)}%` : formatMoney(value);
  return [discount, maximum ? `최대 ${formatMoney(maximum)}` : null, expiry]
    .filter(Boolean)
    .join(" · ");
}

function changedSelection(
  current: ReadonlySet<string>,
  id: string,
  selected: boolean,
) {
  const next = new Set(current);
  if (selected) next.add(id);
  else next.delete(id);
  return next;
}

export function CouponIssuedHistory({
  couponId,
  canManage,
}: CouponIssuedHistoryProps) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<IssuedStatus>("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [reason, setReason] = useState("");
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const query = useQuery({
    ...listIssuedCouponsOptions({
      path: { coupon_id: couponId },
      query: { status, limit: 20, offset: (page - 1) * 20 },
    }),
    placeholderData: keepPreviousData,
  });
  const revokeMutation = useMutation({
    ...revokeCouponsMutation(),
    onSuccess: async (result) => {
      snackbar(
        `${result.affected_count.toLocaleString("ko-KR")}건의 쿠폰을 회수했습니다.`,
      );
      setSelected(new Set());
      setReason("");
      setOperationId(crypto.randomUUID());
      await queryClient.invalidateQueries();
    },
  });

  const resetFailedRevokeOperation = () => {
    if (!revokeMutation.isError) return;
    setOperationId(crypto.randomUUID());
    revokeMutation.reset();
  };

  const selectionColumn: AdminTableColumn<IssuedCouponOut> = {
    key: "select",
    header: "선택",
    render: (issuance) => (
      <Checkbox
        aria-label={`${issuance.user_name} 발급 건 선택`}
        checked={selected.has(issuance.id)}
        disabled={
          issuance.status !== "active" ||
          query.isFetching ||
          revokeMutation.isPending
        }
        onChange={(event) => {
          resetFailedRevokeOperation();
          setSelected((current) =>
            changedSelection(current, issuance.id, event.currentTarget.checked),
          );
        }}
      />
    ),
  };
  const columns: readonly AdminTableColumn<IssuedCouponOut>[] = [
    ...(canManage ? [selectionColumn] : []),
    {
      key: "customer",
      header: "고객",
      render: (issuance) => (
        <VStack gap="x0_5">
          <Text textStyle="bodySm">{issuance.user_name}</Text>
          <Text textStyle="caption" color="fg.neutral-muted">
            {issuance.user_email ?? "이메일 없음"}
          </Text>
        </VStack>
      ),
    },
    {
      key: "status",
      header: "상태",
      render: (issuance) => <StatusBadge status={issuance.status} />,
    },
    {
      key: "issued_at",
      header: "발급일",
      visibility: "medium",
      render: (issuance) => formatDateTime(issuance.issued_at),
    },
    {
      key: "expires_at",
      header: "만료 시각",
      visibility: "large",
      render: (issuance) => formatDateTime(issuance.expires_at),
    },
    {
      key: "snapshot",
      header: "발급 시점 조건",
      visibility: "large",
      render: (issuance) => snapshotLabel(issuance),
    },
  ];
  const selectedIds = Array.from(selected);
  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / 20));

  const revoke = () => {
    if (!canManage || selectedIds.length === 0 || reason.trim().length < 3)
      return;
    revokeMutation.mutate({
      body: {
        operation_id: operationId,
        reason: reason.trim(),
        user_coupon_ids: selectedIds,
      },
    });
  };

  return (
    <VStack gap="x5" alignItems="stretch">
      <AdminCard
        title="발급 이력"
        description="발급 당시 금전 조건을 표시합니다."
      >
        <VStack gap="x4" alignItems="stretch">
          <FilterSelect
            label="발급 상태"
            value={status}
            options={ISSUED_STATUSES.map((value) => ({
              value,
              label: issuedStatusLabel(value),
            }))}
            onValueChange={(value) => {
              resetFailedRevokeOperation();
              setStatus(value as IssuedStatus);
              setPage(1);
              setSelected(new Set());
            }}
          />
          <AdminTable
            label="쿠폰 발급 이력"
            columns={columns}
            rows={query.data?.items}
            getRowKey={(issuance) => issuance.id}
            status={
              query.isLoading || query.isPlaceholderData
                ? "loading"
                : query.isError
                  ? "error"
                  : "success"
            }
            total={query.data?.total}
            onRetry={() => void query.refetch()}
            emptyTitle="발급 이력이 없습니다"
          />
          {query.isSuccess && !query.isPlaceholderData && (
            <Pagination
              page={Math.min(page, totalPages)}
              totalPages={totalPages}
              total={query.data?.total}
              limit={20}
              onPageChange={(nextPage) => {
                resetFailedRevokeOperation();
                setPage(nextPage);
                setSelected(new Set());
              }}
              label="쿠폰 발급 이력 페이지"
            />
          )}
        </VStack>
      </AdminCard>

      {canManage && (
        <AdminCard
          title="선택 발급 건 회수"
          description="활성 발급 건만 선택해 회수할 수 있습니다."
        >
          <VStack gap="x4" alignItems="stretch">
            <Text textStyle="bodySm">
              현재 페이지에서 활성 발급 건{" "}
              {selectedIds.length.toLocaleString("ko-KR")}개를 선택했습니다.
            </Text>
            <TextAreaField
              label="회수 사유"
              required
              maxLength={500}
              value={reason}
              errorMessage={
                reason !== "" && reason.trim().length < 3
                  ? "3자 이상 입력해 주세요."
                  : undefined
              }
              disabled={revokeMutation.isPending}
              onChange={(event) => {
                resetFailedRevokeOperation();
                setReason(event.currentTarget.value);
              }}
            />
            {revokeMutation.isError && (
              <Callout
                role="alert"
                tone="critical"
                title="쿠폰을 회수하지 못했습니다"
                description={getErrorMessage(
                  revokeMutation.error,
                  "선택과 사유는 유지됩니다. 오류 원인을 확인한 뒤 같은 회수 요청을 안전하게 다시 시도할 수 있습니다.",
                )}
              />
            )}
            <ActionButton
              variant="criticalSolid"
              disabled={
                query.isFetching ||
                selectedIds.length === 0 ||
                reason.trim().length < 3
              }
              loading={revokeMutation.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              쿠폰 {selectedIds.length.toLocaleString("ko-KR")}건 회수 검토
            </ActionButton>
          </VStack>
        </AdminCard>
      )}

      <AlertDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`${selectedIds.length.toLocaleString("ko-KR")}건의 쿠폰을 회수할까요?`}
        description={`대상: 현재 선택한 활성 쿠폰 ${selectedIds.length.toLocaleString("ko-KR")}건\n영향: 회수 후 고객이 사용할 수 없으며 이 화면에서 되돌릴 수 없습니다.\n사유: ${reason.trim()}`}
        primaryActionProps={{
          children: `쿠폰 ${selectedIds.length.toLocaleString("ko-KR")}건 회수`,
          variant: "criticalSolid",
          loading: revokeMutation.isPending,
          onClick: revoke,
        }}
        secondaryActionProps={{ children: "취소" }}
      />
    </VStack>
  );
}

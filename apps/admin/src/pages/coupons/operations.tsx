import type {
  CouponAudienceCustomerOut,
  CouponIssueRequest,
} from "@essesion/api-client";
import {
  issueCouponMutation,
  previewCouponAudienceMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Callout,
  Checkbox,
  HStack,
  snackbar,
  Text,
  TextAreaField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { formatDateTime, getErrorMessage } from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { FilterSelect } from "../../shared/ui/filter-select";
import {
  AdminTable,
  type AdminTableColumn,
} from "../../widgets/admin-table/admin-table";
import { Pagination } from "../../widgets/admin-table/pagination";

const AUDIENCE_SEGMENTS = [
  { value: "all", label: "전체 활성 고객" },
  { value: "new30", label: "최근 30일 가입" },
  { value: "birthdayThisMonth", label: "이번 달 생일" },
  { value: "purchased", label: "구매 고객" },
  { value: "notPurchased", label: "미구매 고객" },
  { value: "dormant", label: "휴면 고객" },
] as const;

type AudienceSegment = (typeof AUDIENCE_SEGMENTS)[number]["value"];

export type CouponOperationsProps = {
  couponId: string;
  couponActive: boolean;
  canManage: boolean;
};

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

export function CouponOperations({
  couponId,
  couponActive,
  canManage,
}: CouponOperationsProps) {
  const queryClient = useQueryClient();
  const [segment, setSegment] = useState<AudienceSegment>("all");
  const [excludeIssued, setExcludeIssued] = useState(true);
  const [previewPage, setPreviewPage] = useState(1);
  const [selectedUsers, setSelectedUsers] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [reason, setReason] = useState("");
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const previewMutation = useMutation({
    ...previewCouponAudienceMutation(),
    onSuccess: (_data, variables) => {
      const offset = variables.body.offset ?? 0;
      const limit = variables.body.limit ?? 20;
      setPreviewPage(Math.floor(offset / limit) + 1);
      setSelectedUsers(new Set());
    },
  });

  const runPreview = (page: number) => {
    previewMutation.mutate({
      path: { coupon_id: couponId },
      body: {
        segment,
        exclude_issued: excludeIssued,
        limit: 20,
        offset: (page - 1) * 20,
      },
    });
  };

  const issueMutation = useMutation({
    ...issueCouponMutation(),
    onSuccess: async (result) => {
      snackbar(
        `${result.affected_count.toLocaleString("ko-KR")}명에게 쿠폰을 발급했습니다.`,
      );
      setReason("");
      setSelectedUsers(new Set());
      setOperationId(crypto.randomUUID());
      await queryClient.invalidateQueries();
      runPreview(previewPage);
    },
  });

  const selectedIds = Array.from(selectedUsers);
  const preview = previewMutation.data;
  const targetCount =
    selectedIds.length > 0 ? selectedIds.length : (preview?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil((preview?.total ?? 0) / 20));
  const columns: readonly AdminTableColumn<CouponAudienceCustomerOut>[] = [
    {
      key: "select",
      header: "선택",
      render: (customer) => (
        <Checkbox
          aria-label={`${customer.name} 선택`}
          checked={selectedUsers.has(customer.id)}
          disabled={!canManage || issueMutation.isPending}
          onChange={(event) =>
            setSelectedUsers((current) =>
              changedSelection(
                current,
                customer.id,
                event.currentTarget.checked,
              ),
            )
          }
        />
      ),
    },
    {
      key: "customer",
      header: "고객",
      render: (customer) => (
        <VStack gap="x0_5">
          <Text textStyle="bodySm">{customer.name}</Text>
          <Text textStyle="caption" color="fg.neutral-muted">
            {customer.email ?? "이메일 없음"}
          </Text>
        </VStack>
      ),
    },
    {
      key: "phone",
      header: "전화번호",
      visibility: "medium",
      render: (customer) => customer.phone ?? "-",
    },
    {
      key: "created_at",
      header: "가입일",
      visibility: "large",
      render: (customer) => formatDateTime(customer.created_at),
    },
  ];

  const issue = () => {
    if (!canManage || targetCount === 0 || reason.trim().length < 3) return;
    const target: Pick<
      CouponIssueRequest,
      "expected_count" | "segment" | "user_ids"
    > =
      selectedIds.length > 0
        ? { user_ids: selectedIds }
        : { segment, expected_count: targetCount };
    issueMutation.mutate({
      path: { coupon_id: couponId },
      body: {
        operation_id: operationId,
        reason: reason.trim(),
        exclude_issued: excludeIssued,
        ...target,
      },
    });
  };

  return (
    <VStack gap="x5" alignItems="stretch">
      <AdminCard
        title="고객군 미리보기"
        description="고객군 계산은 서버에서 수행하며 고객 식별 정보는 URL에 저장하지 않습니다."
      >
        <VStack gap="x4" alignItems="stretch">
          <HStack gap="x3" align="flex-end" wrap>
            <FilterSelect
              label="고객군"
              value={segment}
              options={AUDIENCE_SEGMENTS}
              disabled={previewMutation.isPending}
              onValueChange={(value) => {
                setSegment(value as AudienceSegment);
                setPreviewPage(1);
                setSelectedUsers(new Set());
                previewMutation.reset();
              }}
            />
            <Checkbox
              label="이미 발급된 고객 제외"
              checked={excludeIssued}
              disabled={previewMutation.isPending}
              onChange={(event) => {
                setExcludeIssued(event.currentTarget.checked);
                setPreviewPage(1);
                setSelectedUsers(new Set());
                previewMutation.reset();
              }}
            />
            <ActionButton
              variant="neutralOutline"
              loading={previewMutation.isPending}
              onClick={() => runPreview(1)}
            >
              대상 미리보기
            </ActionButton>
          </HStack>

          {previewMutation.isError && (
            <Callout
              role="alert"
              tone="critical"
              title="대상 고객을 불러오지 못했습니다"
              description={getErrorMessage(
                previewMutation.error,
                "고객군 조건을 확인한 뒤 다시 시도해 주세요.",
              )}
            />
          )}

          {(previewMutation.isPending || preview !== undefined) && (
            <VStack gap="x4" alignItems="stretch">
              <Text textStyle="bodySm" color="fg.neutral-muted">
                예상 대상 {preview?.total.toLocaleString("ko-KR") ?? 0}명 · 현재
                페이지에서 {selectedIds.length.toLocaleString("ko-KR")}명 선택
              </Text>
              <AdminTable
                label="쿠폰 대상 고객 미리보기"
                columns={columns}
                rows={preview?.items}
                getRowKey={(customer) => customer.id}
                status={previewMutation.isPending ? "loading" : "success"}
                total={preview?.total}
                emptyTitle="조건에 맞는 고객이 없습니다"
              />
              <Pagination
                page={Math.min(previewPage, totalPages)}
                totalPages={totalPages}
                onPageChange={runPreview}
                label="쿠폰 대상 미리보기 페이지"
              />
            </VStack>
          )}
        </VStack>
      </AdminCard>

      {!canManage ? (
        <Callout
          tone="informative"
          title="조회 전용 권한"
          description="고객군 일괄 발급은 admin 역할만 실행할 수 있습니다."
        />
      ) : (
        <AdminCard
          title="쿠폰 일괄 발급"
          description={`operation ${operationId}`}
        >
          <VStack gap="x4" alignItems="stretch">
            {!couponActive && (
              <Callout
                tone="warning"
                title="비활성 쿠폰은 발급할 수 없습니다"
                description="쿠폰 정의를 활성 상태로 저장한 뒤 다시 시도해 주세요."
              />
            )}
            <Text textStyle="bodySm">
              {selectedIds.length > 0
                ? `미리보기에서 선택한 ${selectedIds.length.toLocaleString("ko-KR")}명에게 발급합니다.`
                : `미리보기 고객군 전체 ${preview?.total.toLocaleString("ko-KR") ?? 0}명에게 발급합니다.`}
            </Text>
            <TextAreaField
              label="발급 사유"
              required
              maxLength={500}
              value={reason}
              errorMessage={
                reason !== "" && reason.trim().length < 3
                  ? "3자 이상 입력해 주세요."
                  : undefined
              }
              disabled={issueMutation.isPending}
              onChange={(event) => setReason(event.currentTarget.value)}
            />
            {issueMutation.isError && (
              <Callout
                role="alert"
                tone="critical"
                title="쿠폰을 발급하지 못했습니다"
                description={getErrorMessage(
                  issueMutation.error,
                  "입력과 operation ID가 유지됩니다. 같은 작업을 안전하게 다시 시도할 수 있습니다.",
                )}
              />
            )}
            <ActionButton
              disabled={
                !couponActive ||
                preview === undefined ||
                previewMutation.isPending ||
                targetCount === 0 ||
                reason.trim().length < 3
              }
              loading={issueMutation.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              발급 내용 확인
            </ActionButton>
          </VStack>
        </AdminCard>
      )}

      <AlertDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`${targetCount.toLocaleString("ko-KR")}명에게 쿠폰을 발급할까요?`}
        description={`사유: ${reason.trim()}\noperation: ${operationId}`}
        primaryActionProps={{
          children: "발급",
          loading: issueMutation.isPending,
          onClick: issue,
        }}
        secondaryActionProps={{ children: "취소" }}
      />
    </VStack>
  );
}

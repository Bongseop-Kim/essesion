import type { IncidentAdminAction } from "@essesion/api-client";
import {
  adminGetPaymentIncidentOptions,
  adminGetPaymentIncidentQueryKey,
  adminListPaymentIncidentsQueryKey,
  adminReconcilePaymentIncidentMutation,
  adminResolvePaymentIncidentMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Callout,
  ContentPlaceholder,
  HStack,
  Skeleton,
  snackbar,
  Text,
  TextAreaField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router";

import {
  formatDateTime,
  formatMoney,
  getErrorMessage,
} from "../../shared/lib/format";
import { useDirtyFormBlocker } from "../../shared/lib/use-dirty-form-blocker";
import { useAdminSession } from "../../shared/session/admin-session";
import { AdminCard } from "../../shared/ui/admin-card";
import { DetailList } from "../../shared/ui/detail-list";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";
import { TechnicalDetails } from "../../shared/ui/technical-details";

function incidentTypeLabel(type: string) {
  const labels: Record<string, string> = {
    confirm: "결제 승인",
    refund: "환불",
    partial_cancel: "부분 취소",
    mixed_state: "상태 불일치",
    amount_mismatch: "금액 불일치",
  };
  return labels[type] ?? type;
}

function createOperationId() {
  return crypto.randomUUID();
}

function incidentAmountSummary(
  expected: number | null,
  observed: number | null,
) {
  if (expected === null || observed === null) {
    return {
      title: "금액 비교 정보가 부족합니다",
      description: "기대 금액과 확인 금액을 모두 확보한 뒤 판단해 주세요.",
      difference: null,
    };
  }
  const difference = observed - expected;
  if (difference === 0) {
    return {
      title: "기대 금액과 확인 금액이 일치합니다",
      description: "금액 외 결제 상태와 요청 근거를 확인해 주세요.",
      difference,
    };
  }
  const direction = difference > 0 ? "많습니다" : "부족합니다";
  return {
    title: `${formatMoney(Math.abs(difference))} 차이`,
    description: `확인 금액이 기대 금액보다 ${formatMoney(Math.abs(difference))} ${direction}`,
    difference,
  };
}

function IncidentDetailLoading() {
  return (
    <VStack gap="x6" alignItems="stretch" aria-busy="true">
      <RouteHeading
        title="결제 이상 상세"
        description="외부 결제 상태와 내부 반영 상태를 함께 확인합니다."
      />
      <AdminCard title="이상 정보">
        <VStack gap="x3" alignItems="stretch">
          <Skeleton width="60%" height={24} />
          <Skeleton width="100%" height={20} />
          <Skeleton width="80%" height={20} />
        </VStack>
      </AdminCard>
      <AdminCard title="대사 근거">
        <Skeleton width="100%" height={120} />
      </AdminCard>
    </VStack>
  );
}

export function IncidentDetailPage() {
  const { incidentId = "" } = useParams();
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const query = useQuery({
    ...adminGetPaymentIncidentOptions({
      path: { incident_id: incidentId },
    }),
    enabled: incidentId !== "",
  });
  const [selectedAction, setSelectedAction] = useState<IncidentAdminAction>();
  const [memo, setMemo] = useState("");
  const [operationId, setOperationId] = useState(createOperationId);
  const [validationError, setValidationError] = useState<string>();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: adminGetPaymentIncidentQueryKey({
          path: { incident_id: incidentId },
        }),
      }),
      queryClient.invalidateQueries({
        queryKey: adminListPaymentIncidentsQueryKey(),
      }),
    ]);
  };

  const reconcileMutation = useMutation({
    ...adminReconcilePaymentIncidentMutation(),
    onSuccess: async () => {
      snackbar("결제 상태를 대사했습니다.");
      setSelectedAction(undefined);
      await refresh();
    },
  });
  const resolveMutation = useMutation({
    ...adminResolvePaymentIncidentMutation(),
    onSuccess: async () => {
      snackbar("결제 이상을 해결 처리했습니다.");
      setSelectedAction(undefined);
      setMemo("");
      setOperationId(createOperationId());
      await refresh();
    },
  });

  const data = query.data;
  const actionPending =
    reconcileMutation.isPending || resolveMutation.isPending;
  const blocker = useDirtyFormBlocker(
    selectedAction !== undefined,
    undefined,
    true,
  );
  const isAdmin =
    session.state.status === "authenticated" &&
    session.state.session.role === "admin";

  if (query.isLoading) return <IncidentDetailLoading />;

  if (query.isError || data === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading
          title="결제 이상 상세"
          description="외부 결제 상태와 내부 반영 상태를 함께 확인합니다."
        />
        <ContentPlaceholder
          title="결제 이상을 불러오지 못했습니다"
          description="인시던트 ID를 확인하거나 다시 시도해 주세요."
          action={
            <ActionButton onClick={() => void query.refetch()}>
              다시 시도
            </ActionButton>
          }
        />
      </VStack>
    );
  }

  const runAction = () => {
    if (selectedAction === undefined || actionPending || !isAdmin) return;
    if (selectedAction.kind === "reconcile") {
      reconcileMutation.mutate({ path: { incident_id: data.id } });
      return;
    }
    resolveMutation.mutate({
      path: { incident_id: data.id },
      body: { operation_id: operationId, memo: memo.trim() },
    });
  };

  const selectAction = (action: IncidentAdminAction) => {
    setSelectedAction(action);
    setMemo("");
    setValidationError(undefined);
    setOperationId(createOperationId());
    reconcileMutation.reset();
    resolveMutation.reset();
  };

  const resetFailedResolveOperation = () => {
    if (!resolveMutation.isError) return;
    setOperationId(createOperationId());
    resolveMutation.reset();
  };

  const submitAction = (event: FormEvent) => {
    event.preventDefault();
    setValidationError(undefined);
    if (selectedAction?.requires_memo && memo.trim().length < 3) {
      setValidationError("해결 근거를 3자 이상 입력해 주세요.");
      return;
    }
    setConfirmOpen(true);
  };

  const amountSummary = incidentAmountSummary(
    data.expected_amount,
    data.observed_amount,
  );

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title={`결제 이상 ${incidentTypeLabel(data.incident_type)}`}
          description="외부 응답 근거를 확인한 뒤 관리자 전용 작업을 실행합니다."
        />
        <StatusBadge status={data.status} />
      </HStack>

      <Callout
        tone={amountSummary.difference === 0 ? "positive" : "warning"}
        title={amountSummary.title}
        description={amountSummary.description}
      />

      <AdminCard title="이상 정보">
        <DetailList
          items={[
            { label: "유형", value: incidentTypeLabel(data.incident_type) },
            { label: "상태", value: data.status },
            { label: "기대 금액", value: formatMoney(data.expected_amount) },
            { label: "확인 금액", value: formatMoney(data.observed_amount) },
            {
              label: "금액 차이",
              value:
                amountSummary.difference === null
                  ? "확인 불가"
                  : formatMoney(amountSummary.difference),
            },
            { label: "발생 시각", value: formatDateTime(data.created_at) },
            { label: "수정 시각", value: formatDateTime(data.updated_at) },
          ]}
        />
      </AdminCard>

      {(data.order_id !== null || data.claim_id !== null) && (
        <AdminCard title="관련 리소스">
          <HStack gap="x4" wrap>
            {data.order_id !== null && (
              <Link to={`/orders/${data.order_id}`}>
                주문 {data.order_number ?? data.order_id}
              </Link>
            )}
            {data.claim_id !== null && (
              <Link to={`/claims/${data.claim_id}`}>
                클레임 {data.claim_number ?? data.claim_id}
              </Link>
            )}
          </HStack>
        </AdminCard>
      )}

      <AdminCard title="처리 감사 정보">
        <DetailList
          items={[
            { label: "해결 시각", value: formatDateTime(data.resolved_at) },
            { label: "해결 메모", value: data.resolution_memo ?? "-" },
          ]}
        />
      </AdminCard>

      <AdminCard title="운영 액션">
        {!isAdmin ? (
          <Callout
            tone="warning"
            title="최고 관리자 권한이 필요합니다"
            description="매니저는 결제 이상 근거를 조회할 수 있지만 대사·해결 작업은 실행할 수 없습니다."
          />
        ) : (
          <VStack gap="x4" alignItems="stretch">
            <HStack gap="x2" wrap>
              {(data.admin_actions ?? []).map((action) => (
                <ActionButton
                  key={action.kind}
                  variant={
                    action.destructive ? "criticalSolid" : "neutralOutline"
                  }
                  disabled={!action.enabled || actionPending}
                  title={action.blocking_reason ?? undefined}
                  onClick={() => selectAction(action)}
                >
                  {action.label}
                </ActionButton>
              ))}
            </HStack>
            {(data.admin_actions ?? [])
              .filter((action) => !action.enabled && action.blocking_reason)
              .map((action) => (
                <Text
                  key={action.kind}
                  textStyle="caption"
                  color="fg.neutral-muted"
                >
                  {action.label}: {action.blocking_reason}
                </Text>
              ))}

            {selectedAction !== undefined && (
              <VStack
                as="form"
                gap="x3"
                alignItems="stretch"
                onSubmit={submitAction}
              >
                <Text as="h3" textStyle="label">
                  {selectedAction.label}
                </Text>
                {selectedAction.kind === "resolve" && (
                  <TextAreaField
                    label="해결 근거 (필수)"
                    description="외부 결제 조회 결과와 내부 반영 판단을 남겨 주세요."
                    value={memo}
                    maxLength={1000}
                    errorMessage={validationError}
                    onChange={(event) => {
                      resetFailedResolveOperation();
                      setMemo(event.currentTarget.value);
                    }}
                  />
                )}
                {(reconcileMutation.isError || resolveMutation.isError) && (
                  <Callout
                    role="alert"
                    tone="critical"
                    title="관리자 작업을 완료하지 못했습니다"
                    description={getErrorMessage(
                      reconcileMutation.error ?? resolveMutation.error,
                      "권한(403) 또는 현재 상태를 확인한 뒤 다시 시도해 주세요.",
                    )}
                  />
                )}
                <HStack gap="x2">
                  <ActionButton type="submit" loading={actionPending}>
                    {selectedAction.label} 검토
                  </ActionButton>
                  <ActionButton
                    type="button"
                    variant="ghost"
                    disabled={actionPending}
                    onClick={() => {
                      setSelectedAction(undefined);
                      setMemo("");
                    }}
                  >
                    취소
                  </ActionButton>
                </HStack>
              </VStack>
            )}
          </VStack>
        )}
      </AdminCard>

      <TechnicalDetails
        json={{
          incident_id: data.id,
          request_id: data.request_id,
          operation_id: data.operation_id,
          actor_id: data.actor_id,
          resolved_by: data.resolved_by,
          reconciliation_details: data.details,
        }}
      />

      <AlertDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`${selectedAction?.label ?? "위험 작업"}을 실행할까요?`}
        description={
          selectedAction?.kind === "reconcile"
            ? "외부 결제 상태를 다시 조회하고 안전한 범위의 내부 상태를 반영합니다. 실행 전에 요청 ID와 금액을 다시 확인해 주세요."
            : `이 작업은 인시던트를 해결 상태로 변경합니다. 입력한 근거: ${memo.trim() || "없음"}`
        }
        primaryActionProps={{
          children: selectedAction?.label ?? "작업 실행",
          variant: "criticalSolid",
          loading: actionPending,
          disabled: actionPending,
          onClick: runAction,
        }}
        secondaryActionProps={{ children: "취소", disabled: actionPending }}
      />
      <AlertDialog
        open={blocker.state === "blocked"}
        title="작성 중인 결제 이상 작업을 버릴까요?"
        description="선택한 작업과 저장하지 않은 해결 근거가 사라집니다."
        primaryActionProps={{
          children: "결제 이상 작업 버리기",
          variant: "criticalSolid",
          onClick: () => blocker.proceed?.(),
        }}
        secondaryActionProps={{
          children: "계속 작성",
          onClick: () => blocker.reset?.(),
        }}
      />
    </VStack>
  );
}

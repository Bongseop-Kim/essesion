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
  Box,
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
  formatIdentifier,
  formatMoney,
  getErrorMessage,
} from "../../shared/lib/format";
import { useAdminSession } from "../../shared/session/admin-session";
import { AdminCard } from "../../shared/ui/admin-card";
import { DetailList } from "../../shared/ui/detail-list";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";

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

  const submitAction = (event: FormEvent) => {
    event.preventDefault();
    setValidationError(undefined);
    if (selectedAction?.requires_memo && memo.trim().length < 3) {
      setValidationError("해결 근거를 3자 이상 입력해 주세요.");
      return;
    }
    setConfirmOpen(true);
  };

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title={`결제 이상 ${incidentTypeLabel(data.incident_type)}`}
          description="외부 응답 근거를 확인한 뒤 관리자 전용 작업을 실행합니다."
        />
        <StatusBadge status={data.status} />
      </HStack>

      <AdminCard title="이상 정보">
        <DetailList
          items={[
            { label: "유형", value: incidentTypeLabel(data.incident_type) },
            { label: "상태", value: data.status },
            { label: "기대 금액", value: formatMoney(data.expected_amount) },
            { label: "확인 금액", value: formatMoney(data.observed_amount) },
            { label: "요청 ID", value: data.request_id },
            { label: "원 작업 ID", value: data.operation_id },
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

      <AdminCard
        title="대사 근거"
        description="민감 결제 키를 제외하고 서버가 정제한 데이터만 표시합니다."
      >
        <Box
          as="pre"
          bg="bg.neutral-weak"
          borderRadius="r2"
          p="x4"
          overflow="auto"
          className="max-h-96 whitespace-pre-wrap break-words"
        >
          <Text as="code" textStyle="caption">
            {JSON.stringify(data.details, null, 2)}
          </Text>
        </Box>
      </AdminCard>

      <AdminCard title="처리 감사 정보">
        <DetailList
          items={[
            { label: "발생 행위자", value: formatIdentifier(data.actor_id) },
            { label: "해결 처리자", value: formatIdentifier(data.resolved_by) },
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
                  onClick={() => {
                    setSelectedAction(action);
                    setValidationError(undefined);
                  }}
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
                    onChange={(event) => setMemo(event.currentTarget.value)}
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
                    확인 후 실행
                  </ActionButton>
                  <ActionButton
                    type="button"
                    variant="ghost"
                    disabled={actionPending}
                    onClick={() => setSelectedAction(undefined)}
                  >
                    취소
                  </ActionButton>
                </HStack>
              </VStack>
            )}
          </VStack>
        )}
      </AdminCard>

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
          children: "실행",
          variant: "criticalSolid",
          loading: actionPending,
          disabled: actionPending,
          onClick: runAction,
        }}
        secondaryActionProps={{ children: "취소", disabled: actionPending }}
      />
    </VStack>
  );
}

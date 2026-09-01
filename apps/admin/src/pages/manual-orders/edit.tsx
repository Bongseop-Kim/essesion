import {
  getManualOrderOptions,
  getManualOrderQueryKey,
  listManualOrdersQueryKey,
  updateManualOrderMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  ContentPlaceholder,
  HStack,
  Skeleton,
  snackbar,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";

import { formatDateTime } from "../../shared/lib/format";
import {
  type ManualOrderKind,
  manualOrderKind,
  manualOrderPath,
} from "../../shared/lib/manual-order-kind";
import { AdminCard } from "../../shared/ui/admin-card";
import { RouteHeading } from "../../shared/ui/route-heading";
import {
  ManualOrderForm,
  manualOrderDraftBody,
  manualOrderDraftFrom,
} from "./manual-order-form";

const NOUN: Record<ManualOrderKind, string> = {
  custom: "수기 주문",
  repair: "수기 수선",
};

function ManualOrderEditLoading({ noun }: { noun: string }) {
  return (
    <VStack gap="x6" alignItems="stretch" aria-busy="true">
      <RouteHeading
        title={`${noun} 수정`}
        description="작업지시서 내용을 불러오고 있습니다."
      />
      <AdminCard title="주문 정보">
        <VStack gap="x3" alignItems="stretch">
          <Skeleton width="60%" height={24} />
          <Skeleton width="100%" height={20} />
          <Skeleton width="80%" height={20} />
        </VStack>
      </AdminCard>
    </VStack>
  );
}

function ManualOrderEdit({ kind }: { kind: ManualOrderKind }) {
  const { manualOrderId = "" } = useParams();
  const noun = NOUN[kind];
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [resetSignal, setResetSignal] = useState(0);
  // 저장 성공 후 navigate가 "저장하지 않은 변경" 다이얼로그를 띄우지 않도록 차단을 건너뛴다.
  const savedRef = useRef(false);
  const query = useQuery({
    ...getManualOrderOptions({ path: { manual_order_id: manualOrderId } }),
    enabled: manualOrderId !== "",
  });
  const updateMutation = useMutation({
    ...updateManualOrderMutation(),
    onSuccess: async (order) => {
      savedRef.current = true;
      snackbar(`${noun}을 저장했습니다.`);
      queryClient.setQueryData(
        getManualOrderQueryKey({ path: { manual_order_id: manualOrderId } }),
        order,
      );
      await queryClient.invalidateQueries({
        queryKey: listManualOrdersQueryKey(),
      });
      navigate(manualOrderPath(kind, manualOrderId));
    },
  });
  const order = query.data;
  const initialDraft = useMemo(
    () => (order === undefined ? undefined : manualOrderDraftFrom(order)),
    [order],
  );

  if (query.isLoading) return <ManualOrderEditLoading noun={noun} />;
  // 편집 중 백그라운드 refetch가 실패해도(query.isError) 기존 데이터가 있으면
  // 폼을 유지한다. 편집할 데이터가 아예 없을 때만 에러 화면을 보여준다.
  if (order === undefined || initialDraft === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading
          title={`${noun} 수정`}
          description="작업지시서 내용을 수정합니다."
        />
        <ContentPlaceholder
          title={`${noun}을 불러오지 못했습니다`}
          description="주문 ID를 확인하거나 다시 시도해 주세요."
          action={
            <ActionButton onClick={() => void query.refetch()}>
              다시 시도
            </ActionButton>
          }
        />
      </VStack>
    );
  }

  // 다른 계열의 주소로 들어왔으면 제 화면으로 보낸다 — 폼이 계열별로 다르다.
  const actualKind = manualOrderKind(order);
  if (actualKind !== kind) {
    return (
      <Navigate to={manualOrderPath(actualKind, order.id, "edit")} replace />
    );
  }

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title={`${order.customer_name} 님의 ${noun} 수정`}
          description={`마지막 수정 ${formatDateTime(order.updated_at)}`}
        />
        <ActionButton
          variant="ghost"
          onClick={() => navigate(manualOrderPath(kind, order.id))}
        >
          상세로
        </ActionButton>
      </HStack>

      <ManualOrderForm
        kind={kind}
        initial={initialDraft}
        manualOrderId={order.id}
        revision={order.updated_at}
        resetSignal={resetSignal}
        submitLabel="변경 저장"
        pending={updateMutation.isPending}
        error={updateMutation.error}
        blockerBypassRef={savedRef}
        errorAction={
          <HStack gap="x2" wrap>
            <ActionButton
              variant="neutralOutline"
              loading={query.isFetching}
              onClick={async () => {
                const result = await query.refetch();
                if (!result.isSuccess) return;
                updateMutation.reset();
                setResetSignal((current) => current + 1);
              }}
            >
              서버 값으로 초기화
            </ActionButton>
          </HStack>
        }
        onSubmit={(draft, revision) => {
          if (revision === undefined) return;
          updateMutation.mutate({
            path: { manual_order_id: order.id },
            body: {
              ...manualOrderDraftBody(draft),
              expected_updated_at: revision,
            },
          });
        }}
      />
    </VStack>
  );
}

export function ManualOrderEditPage() {
  return <ManualOrderEdit kind="custom" />;
}

export function ManualRepairEditPage() {
  return <ManualOrderEdit kind="repair" />;
}

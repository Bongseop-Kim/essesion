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
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { formatDateTime } from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { RouteHeading } from "../../shared/ui/route-heading";
import {
  ManualOrderForm,
  manualOrderDraftBody,
  manualOrderDraftFrom,
} from "./manual-order-form";

function ManualOrderEditLoading() {
  return (
    <VStack gap="x6" alignItems="stretch" aria-busy="true">
      <RouteHeading
        title="수기 주문 수정"
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

export function ManualOrderEditPage() {
  const { manualOrderId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [resetSignal, setResetSignal] = useState(0);
  const query = useQuery({
    ...getManualOrderOptions({ path: { manual_order_id: manualOrderId } }),
    enabled: manualOrderId !== "",
  });
  const updateMutation = useMutation({
    ...updateManualOrderMutation(),
    onSuccess: async (order) => {
      snackbar("수기 주문을 저장했습니다.");
      queryClient.setQueryData(
        getManualOrderQueryKey({ path: { manual_order_id: manualOrderId } }),
        order,
      );
      await queryClient.invalidateQueries({
        queryKey: listManualOrdersQueryKey(),
      });
      navigate(`/manual-orders/${manualOrderId}`);
    },
  });
  const order = query.data;
  const initialDraft = useMemo(
    () => (order === undefined ? undefined : manualOrderDraftFrom(order)),
    [order],
  );

  if (query.isLoading) return <ManualOrderEditLoading />;
  if (query.isError || order === undefined || initialDraft === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading
          title="수기 주문 수정"
          description="작업지시서 내용을 수정합니다."
        />
        <ContentPlaceholder
          title="수기 주문을 불러오지 못했습니다"
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

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title={`${order.customer_name} 님의 수기 주문 수정`}
          description={`마지막 수정 ${formatDateTime(order.updated_at)}`}
        />
        <ActionButton
          variant="ghost"
          onClick={() => navigate(`/manual-orders/${order.id}`)}
        >
          상세로
        </ActionButton>
      </HStack>

      <ManualOrderForm
        initial={initialDraft}
        revision={order.updated_at}
        resetSignal={resetSignal}
        submitLabel="변경 저장"
        pending={updateMutation.isPending}
        error={updateMutation.error}
        errorAction={
          <HStack gap="x2" wrap>
            <ActionButton
              variant="neutralOutline"
              loading={query.isFetching}
              onClick={async () => {
                const result = await query.refetch();
                if (result.data === undefined) return;
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

import {
  createManualOrderMutation,
  listManualOrdersQueryKey,
} from "@essesion/api-client/query";
import { ActionButton, HStack, snackbar, VStack } from "@essesion/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useNavigate } from "react-router";

import { RouteHeading } from "../../shared/ui/route-heading";
import {
  emptyManualOrderDraft,
  ManualOrderForm,
  manualOrderDraftBody,
} from "./manual-order-form";

export function ManualOrderNewPage() {
  const navigate = useNavigate();
  const initial = useMemo(
    () => ({
      ...emptyManualOrderDraft,
      // 종이 작업지시서는 접수 당일에 옮겨 적으므로 오늘을 기본값으로
      orderDate: new Date().toLocaleDateString("en-CA"),
    }),
    [],
  );
  const queryClient = useQueryClient();
  const mutation = useMutation({
    ...createManualOrderMutation(),
    onSuccess: async (order) => {
      snackbar("수기 주문을 등록했습니다.");
      await queryClient.invalidateQueries({
        queryKey: listManualOrdersQueryKey(),
      });
      navigate(`/manual-orders/${order.id}`, { replace: true });
    },
  });

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title="수기 주문 등록"
          description="종이 작업지시서 내용을 입력해 수기 주문을 등록합니다."
        />
        <ActionButton
          variant="ghost"
          onClick={() => navigate("/manual-orders")}
        >
          목록으로
        </ActionButton>
      </HStack>
      <ManualOrderForm
        initial={initial}
        resetSignal={0}
        submitLabel="수기 주문 등록"
        pending={mutation.isPending}
        error={mutation.error}
        onSubmit={(draft) =>
          mutation.mutate({ body: manualOrderDraftBody(draft) })
        }
      />
    </VStack>
  );
}

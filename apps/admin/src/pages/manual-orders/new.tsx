import {
  createManualOrderMutation,
  listManualOrdersQueryKey,
} from "@essesion/api-client/query";
import { ActionButton, HStack, snackbar, VStack } from "@essesion/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { useNavigate } from "react-router";

import type { ManualOrderKind } from "../../shared/lib/manual-order-kind";
import { RouteHeading } from "../../shared/ui/route-heading";
import {
  emptyManualOrderDraft,
  ManualOrderForm,
  manualOrderDraftBody,
} from "./manual-order-form";

const COPY = {
  custom: {
    title: "수기 주문 등록",
    description: "종이 작업지시서의 주문제작 내용을 입력해 등록합니다.",
    submit: "수기 주문 등록",
    saved: "수기 주문을 등록했습니다.",
  },
  repair: {
    title: "수기 수선 등록",
    description: "종이 작업지시서의 수선 내용을 입력해 등록합니다.",
    submit: "수기 수선 등록",
    saved: "수기 수선을 등록했습니다.",
  },
} as const satisfies Record<ManualOrderKind, unknown>;

function ManualOrderNew({ kind }: { kind: ManualOrderKind }) {
  const navigate = useNavigate();
  const copy = COPY[kind];
  const initial = useMemo(
    () => ({
      ...emptyManualOrderDraft(kind),
      // 종이 작업지시서는 접수 당일에 옮겨 적으므로 오늘을 기본값으로
      orderDate: new Date().toLocaleDateString("en-CA"),
    }),
    [kind],
  );
  const queryClient = useQueryClient();
  // 저장 성공 후 navigate가 "저장하지 않은 변경" 다이얼로그를 띄우지 않도록 차단을 건너뛴다.
  const savedRef = useRef(false);
  const mutation = useMutation({
    ...createManualOrderMutation(),
    onSuccess: async (order) => {
      savedRef.current = true;
      snackbar(copy.saved);
      await queryClient.invalidateQueries({
        queryKey: listManualOrdersQueryKey(),
      });
      // 등록 직후 상세는 방금 고른 계열이 확실하다 — 응답을 다시 판별하지 않는다.
      navigate(
        kind === "repair"
          ? `/manual-orders/repairs/${order.id}`
          : `/manual-orders/${order.id}`,
        { replace: true },
      );
    },
  });

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading title={copy.title} description={copy.description} />
        <ActionButton
          variant="ghost"
          onClick={() => navigate("/manual-orders")}
        >
          목록으로
        </ActionButton>
      </HStack>
      <ManualOrderForm
        kind={kind}
        initial={initial}
        resetSignal={0}
        submitLabel={copy.submit}
        pending={mutation.isPending}
        error={mutation.error}
        blockerBypassRef={savedRef}
        onSubmit={(draft) =>
          mutation.mutate({ body: manualOrderDraftBody(draft) })
        }
      />
    </VStack>
  );
}

export function ManualOrderNewPage() {
  return <ManualOrderNew kind="custom" />;
}

export function ManualRepairNewPage() {
  return <ManualOrderNew kind="repair" />;
}

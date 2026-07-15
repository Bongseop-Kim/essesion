import type { ManualOrderOut } from "@essesion/api-client";
import {
  deleteManualOrderMutation,
  getManualOrderOptions,
  listManualOrdersQueryKey,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Badge,
  Box,
  ContentPlaceholder,
  HStack,
  Skeleton,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";

import {
  formatDate,
  formatDateTime,
  formatMoney,
} from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { type DetailItem, DetailList } from "../../shared/ui/detail-list";
import { RouteHeading } from "../../shared/ui/route-heading";

type ManualOrderItemOut = ManualOrderOut["items"][number];

function itemCategoryLabel(item: ManualOrderItemOut) {
  const categories = [
    item.automatic != null && "자동수선",
    item.width != null && "폭수선",
    item.restoration != null && "복원수선",
  ].filter((value): value is string => typeof value === "string");
  return categories.length === 0 ? "-" : categories.join(" · ");
}

function itemDetailItems(item: ManualOrderItemOut): DetailItem[] {
  const items: DetailItem[] = [
    { label: "수량", value: `${item.quantity.toLocaleString("ko-KR")}개` },
    { label: "대분류", value: itemCategoryLabel(item) },
  ];
  if (item.automatic != null) {
    items.push(
      {
        label: "[자동] 타입·마감",
        value: `${item.automatic.mechanism === "string" ? "끈" : "지퍼"} · ${
          item.automatic.turn_knot ? "돌려묶기" : "방"
        } · ${item.automatic.dimple ? "딤플" : "기본"}`,
      },
      {
        label: "[자동] 총장",
        value: `${item.automatic.total_length_cm}cm`,
      },
    );
  }
  if (item.width != null) {
    items.push({
      label: "[폭] 폭",
      value: `${item.width.target_width_cm}cm`,
    });
  }
  if (item.restoration != null) {
    items.push({
      label: "[복원] 내용",
      value: item.restoration.memo === "" ? "-" : item.restoration.memo,
    });
  }
  const note = item.note ?? "";
  if (note !== "") items.push({ label: "특이사항", value: note });
  return items;
}

function ManualOrderDetailLoading() {
  return (
    <VStack gap="x6" alignItems="stretch" aria-busy="true">
      <RouteHeading
        title="수기 주문 상세"
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

export function ManualOrderDetailPage() {
  const { manualOrderId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const query = useQuery({
    ...getManualOrderOptions({ path: { manual_order_id: manualOrderId } }),
    enabled: manualOrderId !== "",
  });
  const deleteMutation = useMutation({
    ...deleteManualOrderMutation(),
    onSuccess: async () => {
      snackbar("수기 주문을 삭제했습니다.");
      await queryClient.invalidateQueries({
        queryKey: listManualOrdersQueryKey(),
      });
      navigate("/manual-orders", { replace: true });
    },
    onError: () => {
      snackbar("수기 주문을 삭제하지 못했습니다.");
    },
  });
  const order = query.data;

  if (query.isLoading) return <ManualOrderDetailLoading />;
  if (query.isError || order === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading
          title="수기 주문 상세"
          description="작업지시서 내용을 확인합니다."
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

  const statusFlags = [
    ["접수", order.is_received],
    ["결제", order.is_paid],
    ["확인", order.is_confirmed],
  ] as const;

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title={`${order.customer_name} 님의 수기 주문`}
          description={`마지막 수정 ${formatDateTime(order.updated_at)}`}
        />
        <HStack gap="x2" wrap>
          <ActionButton
            variant="ghost"
            onClick={() => navigate("/manual-orders")}
          >
            목록으로
          </ActionButton>
          <ActionButton
            variant="neutralWeak"
            onClick={() => navigate(`/manual-orders/${order.id}/edit`)}
          >
            수정
          </ActionButton>
        </HStack>
      </HStack>

      <AdminCard
        title="주문 정보"
        action={
          <HStack gap="x2" wrap>
            {statusFlags.map(([label, checked]) => (
              <Badge key={label} tone={checked ? "positive" : "neutral"}>
                {label}
              </Badge>
            ))}
          </HStack>
        }
      >
        <DetailList
          items={[
            { label: "날짜", value: formatDate(order.order_date) },
            { label: "이름", value: order.customer_name },
            { label: "휴대폰", value: order.phone },
            {
              label: "주소",
              value:
                order.address === null || order.address === ""
                  ? "-"
                  : order.address,
            },
            { label: "금액", value: formatMoney(order.amount) },
            { label: "택배비", value: formatMoney(order.shipping_fee) },
          ]}
        />
      </AdminCard>

      <AdminCard
        title="수선 품목"
        description={`총 ${order.items.length.toLocaleString("ko-KR")}개 품목`}
      >
        {order.items.length === 0 ? (
          <ContentPlaceholder title="등록된 품목이 없습니다" />
        ) : (
          <VStack gap="x4" alignItems="stretch">
            {order.items.map((item, index) => (
              <Box
                key={index}
                borderWidth={1}
                borderColor="stroke.neutral"
                borderRadius="r2"
                p="x4"
              >
                <VStack gap="x3" alignItems="stretch">
                  <Text as="h3" textStyle="labelSm">
                    품목 {index + 1}
                  </Text>
                  <DetailList items={itemDetailItems(item)} />
                </VStack>
              </Box>
            ))}
          </VStack>
        )}
      </AdminCard>

      <HStack justify="flex-end">
        <ActionButton
          variant="criticalSolid"
          loading={deleteMutation.isPending}
          onClick={() => setDeleteConfirmOpen(true)}
        >
          수기 주문 삭제
        </ActionButton>
      </HStack>

      <AlertDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="이 수기 주문을 삭제할까요?"
        description="삭제한 작업지시서는 복구할 수 없습니다."
        primaryActionProps={{
          children: "삭제",
          variant: "criticalSolid",
          loading: deleteMutation.isPending,
          onClick: () =>
            deleteMutation.mutate({ path: { manual_order_id: order.id } }),
        }}
        secondaryActionProps={{ children: "취소" }}
      />
    </VStack>
  );
}

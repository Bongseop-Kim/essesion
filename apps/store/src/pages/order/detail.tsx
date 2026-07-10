import type { OrderItemOut } from "@essesion/api-client";
import { getOrderOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  Badge,
  Callout,
  ContentPlaceholder,
  Divider,
  HStack,
  List,
  ListItem,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "react-router";
import {
  canRegisterRepairShipment,
  formatOrderDate,
  orderStatusTone,
  orderTypeLabel,
} from "@/features/orders";
import { reformServiceLabel } from "@/features/reform";
import { courierLabel } from "@/features/repair-shipping";
import { krw } from "@/pages/shop/constants";
import { ContentLayout } from "@/shared/ui/content-layout";
import { SummaryCard } from "@/shared/ui/summary-card";

export function OrderDetailPage() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const orderQuery = useQuery({
    ...getOrderOptions({ path: { order_id: orderId ?? "" } }),
    enabled: !!orderId,
  });

  if (!orderId) return <Navigate to="/my-page/orders" replace />;

  const order = orderQuery.data;

  return (
    <ContentLayout
      breadcrumbs={[
        { label: "홈", href: "/" },
        { label: "주문 내역", href: "/my-page/orders" },
        { label: "주문 상세" },
      ]}
      sidebar={
        order ? (
          <SummaryCard.Root>
            <SummaryCard.Section title="결제 금액" />
            <Divider />
            <SummaryCard.Row
              label="상품·수선 금액"
              value={`${krw.format(order.original_price)}원`}
            />
            <SummaryCard.Row
              label="할인"
              value={`-${krw.format(order.total_discount)}원`}
              tone={order.total_discount > 0 ? "informative" : "neutral"}
            />
            <SummaryCard.Row
              label="배송비"
              value={`${krw.format(order.shipping_cost)}원`}
            />
            <SummaryCard.Total
              label="결제 금액"
              value={`${krw.format(order.total_price)}원`}
            />
          </SummaryCard.Root>
        ) : null
      }
    >
      {orderQuery.isPending ? (
        <VStack gap="x4" alignItems="stretch">
          <Skeleton width="45%" height={32} />
          <Skeleton width="100%" height={96} />
          <Skeleton width="100%" height={160} />
        </VStack>
      ) : orderQuery.isError || !order ? (
        <ContentPlaceholder
          title="주문을 불러오지 못했습니다"
          description="주문 내역에서 다시 시도해 주세요."
          action={
            <ActionButton
              type="button"
              variant="neutralOutline"
              onClick={() => navigate("/my-page/orders")}
            >
              주문 내역으로 이동
            </ActionButton>
          }
        />
      ) : (
        <VStack gap="x6" alignItems="stretch">
          <VStack gap="x2">
            <HStack gap="x3">
              <Text as="h1" textStyle="title1">
                {order.order_number}
              </Text>
              <Badge tone={orderStatusTone(order.status)}>{order.status}</Badge>
            </HStack>
            <Text textStyle="caption" color="fg.neutral-muted">
              {orderTypeLabel(order.order_type)} 주문 ·{" "}
              {formatOrderDate(order.created_at)}
            </Text>
          </VStack>

          {canRegisterRepairShipment(order) ? (
            <Callout
              tone="informative"
              title="수선품을 보내셨나요?"
              description="발송 확인을 해주세요. 송장번호가 있다면 함께 등록할 수 있습니다."
              onClick={() => navigate(`/order/${order.id}/repair-shipping`)}
            />
          ) : null}

          {order.status === "수거예정" ? (
            <Callout
              tone="neutral"
              title="방문 수거 예정"
              description="기사님이 입력한 수거지에 방문해 수선품을 수거할 예정입니다."
            />
          ) : null}

          {order.order_type === "repair" && order.courier_company ? (
            <VStack gap="x2" alignItems="stretch">
              <Text as="h2" textStyle="title3">
                발송 정보
              </Text>
              <Text textStyle="body">
                {courierLabel(order.courier_company)} ·{" "}
                {order.tracking_number ?? "-"}
              </Text>
              {order.shipped_at ? (
                <Text textStyle="caption" color="fg.neutral-muted">
                  발송 등록일 {formatOrderDate(order.shipped_at)}
                </Text>
              ) : null}
            </VStack>
          ) : null}

          <VStack gap="x3" alignItems="stretch">
            <Text as="h2" textStyle="title3">
              주문 상품 {order.items?.length ?? 0}개
            </Text>
            <List>
              {(order.items ?? []).map((item) => (
                <ListItem
                  key={item.id}
                  title={orderItemTitle(item)}
                  description={`${item.quantity}개 · ${krw.format(item.unit_price)}원`}
                />
              ))}
            </List>
          </VStack>
        </VStack>
      )}
    </ContentLayout>
  );
}

function orderItemTitle(item: OrderItemOut): string {
  if (item.item_type !== "reform") return "상품";
  // item_data는 reform 스냅샷(ReformDataOut 형태) — 형태가 다르면 폴백
  const data = item.item_data;
  if (data && typeof data === "object" && "tie" in data) {
    try {
      const label = reformServiceLabel(
        data as unknown as Parameters<typeof reformServiceLabel>[0],
      );
      if (label) return `넥타이 수선 — ${label}`;
    } catch {
      // 폴백으로 진행
    }
  }
  return "넥타이 수선";
}

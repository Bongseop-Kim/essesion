import type { OrderItemOut } from "@essesion/api-client";
import {
  confirmPurchaseMutation,
  getOrderOptions,
  getOrderQueryKey,
  listMyOrdersQueryKey,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Badge,
  Box,
  ContentPlaceholder,
  Divider,
  HStack,
  Skeleton,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";

import {
  ClaimFormModal,
  ClaimItemActions,
  type ClaimType,
} from "@/features/claims";
import {
  canRegisterRepairShipment,
  formatOrderDate,
  orderStatusTone,
  orderTypeLabel,
} from "@/features/orders";
import { reformServiceLabel } from "@/features/reform";
import {
  courierLabel,
  courierTrackingUrl,
  RepairInboundAddress,
} from "@/features/repair-shipping";
import { krw } from "@/pages/shop/constants";
import { ContentLayout } from "@/shared/ui/content-layout";
import { SummaryCard } from "@/shared/ui/summary-card";

type ClaimTarget = { type: ClaimType; item: OrderItemOut };

export function OrderDetailPage() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [claimTarget, setClaimTarget] = useState<ClaimTarget | null>(null);
  const orderQuery = useQuery({
    ...getOrderOptions({ path: { order_id: orderId ?? "" } }),
    enabled: !!orderId,
  });
  const confirmPurchase = useMutation({
    ...confirmPurchaseMutation(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getOrderQueryKey({ path: { order_id: orderId ?? "" } }),
        }),
        queryClient.invalidateQueries({ queryKey: listMyOrdersQueryKey() }),
      ]);
      snackbar("구매를 확정했습니다.");
    },
    onError: () => snackbar("구매를 확정하지 못했습니다. 다시 시도해 주세요."),
  });

  if (!orderId) return <Navigate to="/my-page/orders" replace />;

  const order = orderQuery.data;
  const customerActions = order?.customer_actions ?? [];

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
            <RepairInboundAddress
              onRegisterShipment={() =>
                navigate(`/order/${order.id}/repair-shipping`)
              }
            />
          ) : null}

          {order.status === "수거예정" ? (
            <Box bg="bg.neutral-weak" borderRadius="r3" p="x4">
              <VStack gap="x1">
                <Text textStyle="labelSm">방문 수거 예정</Text>
                <Text textStyle="bodySm" color="fg.neutral-muted">
                  기사님이 입력한 수거지에 방문해 수선품을 수거할 예정입니다.
                </Text>
              </VStack>
            </Box>
          ) : null}

          <ShipmentInfo
            title={
              order.order_type === "repair" ? "고객 발송 정보" : "배송 정보"
            }
            courier={order.courier_company}
            trackingNumber={order.tracking_number}
            shippedAt={order.shipped_at}
          />
          {order.order_type === "repair" ? (
            <ShipmentInfo
              title="업체 발송 정보"
              courier={order.company_courier_company}
              trackingNumber={order.company_tracking_number}
              shippedAt={order.company_shipped_at}
            />
          ) : null}

          {order.shipping_address ? (
            <VStack gap="x3" alignItems="stretch">
              <Text as="h2" textStyle="title3">
                배송지 정보
              </Text>
              <InfoRow
                label="받는 사람"
                value={order.shipping_address.recipient_name}
              />
              <InfoRow
                label="연락처"
                value={order.shipping_address.recipient_phone}
              />
              <InfoRow
                label="주소"
                value={`(${order.shipping_address.postal_code}) ${order.shipping_address.address}${order.shipping_address.address_detail ? ` ${order.shipping_address.address_detail}` : ""}`}
              />
              {order.shipping_address.delivery_request ||
              order.shipping_address.delivery_memo ? (
                <InfoRow
                  label="배송 요청"
                  value={
                    order.shipping_address.delivery_request ??
                    order.shipping_address.delivery_memo ??
                    ""
                  }
                />
              ) : null}
            </VStack>
          ) : null}

          {customerActions.includes("confirm_purchase") ? (
            <Box bg="bg.neutral-weak" borderRadius="r3" p="x4">
              <VStack gap="x3" alignItems="stretch">
                <VStack gap="x1">
                  <Text as="h2" textStyle="title3">
                    구매확정
                  </Text>
                  <Text textStyle="bodySm" color="fg.neutral-muted">
                    상품 수령을 마쳤다면 구매를 확정해 주세요. 확정 후에는
                    반품·교환을 신청할 수 없습니다.
                  </Text>
                </VStack>
                <ActionButton
                  type="button"
                  variant="neutralWeak"
                  onClick={() => setConfirmOpen(true)}
                >
                  구매확정
                </ActionButton>
              </VStack>
            </Box>
          ) : null}

          <VStack gap="x3" alignItems="stretch">
            <Text as="h2" textStyle="title3">
              주문 상품 {order.items?.length ?? 0}개
            </Text>
            <VStack gap="x3" alignItems="stretch">
              {(order.items ?? []).map((item) => (
                <Box
                  key={item.id}
                  borderWidth={1}
                  borderColor="stroke.neutral-weak"
                  borderRadius="r3"
                  p="x4"
                >
                  <VStack gap="x3" alignItems="stretch">
                    <HStack justify="space-between" gap="x4" align="flex-start">
                      <VStack gap="x1">
                        <Text textStyle="body">{orderItemTitle(item)}</Text>
                        <Text textStyle="caption" color="fg.neutral-muted">
                          {item.quantity}개 · {krw.format(item.unit_price)}원
                        </Text>
                      </VStack>
                      <Text textStyle="labelSm">
                        {krw.format(item.unit_price * item.quantity)}원
                      </Text>
                    </HStack>
                    <ClaimItemActions
                      item={item}
                      customerActions={customerActions}
                      onSelect={(type, selectedItem) =>
                        setClaimTarget({ type, item: selectedItem })
                      }
                    />
                  </VStack>
                </Box>
              ))}
            </VStack>
          </VStack>

          <AlertDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="구매를 확정할까요?"
            description="구매확정 후에는 이 주문의 반품·교환을 신청할 수 없습니다."
            primaryActionProps={{
              children: "구매확정",
              loading: confirmPurchase.isPending,
              onClick: () =>
                confirmPurchase.mutate({ path: { order_id: order.id } }),
            }}
            secondaryActionProps={{ children: "돌아가기" }}
          />

          {claimTarget ? (
            <ClaimFormModal
              open
              onOpenChange={(open) => {
                if (!open) setClaimTarget(null);
              }}
              type={claimTarget.type}
              order={order}
              item={claimTarget.item}
            />
          ) : null}
        </VStack>
      )}
    </ContentLayout>
  );
}

function ShipmentInfo({
  title,
  courier,
  trackingNumber,
  shippedAt,
}: {
  title: string;
  courier: string | null;
  trackingNumber: string | null;
  shippedAt: string | null;
}) {
  if (!courier && !trackingNumber && !shippedAt) return null;
  const trackingUrl = courierTrackingUrl(courier, trackingNumber);
  return (
    <VStack gap="x2" alignItems="stretch">
      <Text as="h2" textStyle="title3">
        {title}
      </Text>
      <HStack justify="space-between" gap="x4" align="flex-start">
        <VStack gap="x1">
          <Text textStyle="body">
            {courierLabel(courier)} · {trackingNumber ?? "-"}
          </Text>
          {shippedAt ? (
            <Text textStyle="caption" color="fg.neutral-muted">
              발송 등록일 {formatOrderDate(shippedAt)}
            </Text>
          ) : null}
        </VStack>
        {trackingUrl ? (
          <ActionButton
            type="button"
            size="small"
            variant="neutralOutline"
            onClick={() =>
              window.open(trackingUrl, "_blank", "noopener,noreferrer")
            }
          >
            배송조회
          </ActionButton>
        ) : null}
      </HStack>
    </VStack>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <HStack justify="space-between" gap="x4" align="flex-start">
      <Text textStyle="bodySm" color="fg.neutral-muted">
        {label}
      </Text>
      <Text textStyle="bodySm">{value}</Text>
    </HStack>
  );
}

function orderItemTitle(item: OrderItemOut): string {
  if (item.item_type === "product") {
    return item.product_id ? `상품 #${item.product_id}` : "상품";
  }
  if (item.item_type === "custom") return "맞춤 주문";
  if (item.item_type === "sample") return "샘플 주문";
  if (item.item_type === "token") return "디자인 토큰";
  const data = item.item_data;
  if (data && typeof data === "object" && "tie" in data) {
    try {
      const label = reformServiceLabel(
        data as unknown as Parameters<typeof reformServiceLabel>[0],
      );
      if (label) return `넥타이 수선 — ${label}`;
    } catch {
      // 형태가 다른 이관 데이터는 기본 라벨로 표시한다.
    }
  }
  return "넥타이 수선";
}

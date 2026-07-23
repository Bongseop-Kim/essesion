import {
  createMyOrderReferenceImageReadUrl,
  createMyRepairReceiptPhotoReadUrl,
  createReadUrl,
  type OrderItemOut,
  type OrderReferenceImageOut,
  type RepairShippingReceiptOut,
} from "@essesion/api-client";
import {
  confirmPurchaseMutation,
  getOrderOptions,
  getOrderQueryKey,
  listMyOrderReferenceImagesOptions,
  listMyOrdersQueryKey,
  listMyRepairReceiptPhotosOptions,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Badge,
  Box,
  Callout,
  ContentPlaceholder,
  claimBadge,
  Divider,
  decodeOrderItemContent,
  Grid,
  HStack,
  ImageFrame,
  Skeleton,
  snackbar,
  Tag,
  TagGroup,
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
  claimItemTitle,
  TokenRefundSection,
} from "@/features/claims";
import {
  canRegisterRepairShipment,
  orderStatusTone,
  orderTypeLabel,
} from "@/features/orders";
import { reformServiceLabel } from "@/features/reform";
import {
  courierLabel,
  courierTrackingUrl,
  RepairInboundAddress,
} from "@/features/repair-shipping";
import { ReviewFormModal, type ReviewTarget } from "@/features/reviews";
import { deliveryRequestLabel } from "@/features/shipping";
import { krw } from "@/pages/shop/constants";
import { formatDate } from "@/shared/lib/format";
import { ContentLayout } from "@/shared/ui/content-layout";
import { InfoRow } from "@/shared/ui/info-row";
import { SummaryCard } from "@/shared/ui/summary-card";

type ClaimTarget = { type: ClaimType; item: OrderItemOut };

export function OrderDetailPage() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [claimTarget, setClaimTarget] = useState<ClaimTarget | null>(null);
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const orderQuery = useQuery({
    ...getOrderOptions({ path: { order_id: orderId ?? "" } }),
    enabled: !!orderId,
  });
  const order = orderQuery.data;
  const referenceImagesQuery = useQuery({
    ...listMyOrderReferenceImagesOptions({
      path: { order_id: orderId ?? "" },
    }),
    enabled:
      !!orderId &&
      (order?.order_type === "custom" || order?.order_type === "sample"),
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

  const customerActions = order?.customer_actions ?? [];
  const summaryClaim = order?.claim_summary
    ? claimBadge(order.claim_summary)
    : null;
  const openReview = (target: ReviewTarget) => {
    setReviewTarget(target);
    setReviewOpen(true);
  };

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
            <HStack gap="x3" wrap>
              <Text as="h1" textStyle="title1">
                {order.order_number}
              </Text>
              <Badge tone={orderStatusTone(order.status)}>{order.status}</Badge>
              {summaryClaim ? (
                <Badge tone={summaryClaim.tone}>{summaryClaim.label}</Badge>
              ) : null}
            </HStack>
            <Text textStyle="caption" color="fg.neutral-muted">
              {orderTypeLabel(order.order_type)} 주문 ·{" "}
              {formatDate(order.created_at)}
            </Text>
          </VStack>

          {canRegisterRepairShipment(order) &&
          customerActions.includes("claim_cancel") ? (
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
                    deliveryRequestLabel(
                      order.shipping_address.delivery_request,
                      order.shipping_address.delivery_memo,
                    ) ??
                    order.shipping_address.delivery_memo ??
                    ""
                  }
                />
              ) : null}
            </VStack>
          ) : null}

          {order.repair_pickup ? (
            <VStack gap="x3" alignItems="stretch">
              <Text as="h2" textStyle="title3">
                수거 요청
              </Text>
              <InfoRow
                label="수거 대상"
                value={`${order.repair_pickup.recipient_name} · ${order.repair_pickup.recipient_phone}`}
              />
              <InfoRow
                label="수거지"
                value={`${order.repair_pickup.postal_code ?? ""} ${order.repair_pickup.address} ${order.repair_pickup.detail_address ?? ""}`.trim()}
              />
              <InfoRow
                label="수거 비용"
                value={`${krw.format(order.repair_pickup.pickup_fee)}원`}
              />
            </VStack>
          ) : null}

          {(order.repair_receipts ?? []).length > 0 ? (
            <VStack gap="x3" alignItems="stretch">
              <Text as="h2" textStyle="title3">
                고객 발송 접수
              </Text>
              {(order.repair_receipts ?? []).map((receipt) => (
                <RepairReceipt
                  key={receipt.id}
                  orderId={order.id}
                  receipt={receipt}
                />
              ))}
            </VStack>
          ) : null}

          {order.order_type === "token" ? (
            <TokenRefundSection orderId={order.id} />
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

          {order.order_type !== "sale" &&
          order.order_type !== "token" &&
          (customerActions.includes("write_review") || order.review_id) ? (
            <Box bg="bg.neutral-weak" borderRadius="r3" p="x4">
              <VStack gap="x3" alignItems="stretch">
                <VStack gap="x1">
                  <Text as="h2" textStyle="title3">
                    서비스 후기
                  </Text>
                  <Text textStyle="bodySm" color="fg.neutral-muted">
                    이용한 서비스의 별점과 후기를 남겨 주세요.
                  </Text>
                </VStack>
                <ActionButton
                  type="button"
                  variant="neutralWeak"
                  onClick={() =>
                    openReview({
                      orderId: order.id,
                      reviewId: order.review_id ?? undefined,
                    })
                  }
                >
                  {order.review_id ? "작성한 후기 보기" : "후기 작성"}
                </ActionButton>
              </VStack>
            </Box>
          ) : null}

          <VStack gap="x3" alignItems="stretch">
            <Text as="h2" textStyle="title3">
              주문 상품 {order.items?.length ?? 0}개
            </Text>
            <VStack gap="x3" alignItems="stretch">
              {(order.items ?? []).map((item) => {
                const itemClaim = item.claim ? claimBadge(item.claim) : null;
                return (
                  <Box
                    key={item.id}
                    borderWidth={1}
                    borderColor="stroke.neutral-weak"
                    borderRadius="r3"
                    p="x4"
                  >
                    <VStack gap="x3" alignItems="stretch">
                      <HStack
                        justify="space-between"
                        gap="x4"
                        align="flex-start"
                      >
                        <VStack gap="x1">
                          <HStack gap="x2" wrap>
                            <Text textStyle="body">{orderItemTitle(item)}</Text>
                            {itemClaim ? (
                              <Badge tone={itemClaim.tone}>
                                {itemClaim.label}
                              </Badge>
                            ) : null}
                          </HStack>
                          <Text textStyle="caption" color="fg.neutral-muted">
                            {item.quantity}개 · {krw.format(item.unit_price)}원
                          </Text>
                        </VStack>
                        <Text textStyle="labelSm">
                          {krw.format(item.unit_price * item.quantity)}원
                        </Text>
                      </HStack>
                      <OrderContent orderType={order.order_type} item={item} />
                      <ClaimItemActions
                        item={item}
                        customerActions={customerActions}
                        onSelect={(type, selectedItem) =>
                          setClaimTarget({ type, item: selectedItem })
                        }
                      />
                      {order.order_type === "sale" &&
                      item.item_type === "product" &&
                      (item.review_id ||
                        customerActions.includes("write_review")) ? (
                        <ActionButton
                          type="button"
                          variant="neutralOutline"
                          onClick={() =>
                            openReview({
                              orderId: order.id,
                              orderItemId: item.id,
                              reviewId: item.review_id ?? undefined,
                            })
                          }
                        >
                          {item.review_id ? "작성한 후기 보기" : "후기 작성"}
                        </ActionButton>
                      ) : null}
                    </VStack>
                  </Box>
                );
              })}
            </VStack>
          </VStack>

          <OrderReferenceImages
            orderId={order.id}
            show={
              order.order_type === "custom" || order.order_type === "sample"
            }
            images={referenceImagesQuery.data}
            pending={referenceImagesQuery.isPending}
            error={referenceImagesQuery.isError}
            onRetry={() => void referenceImagesQuery.refetch()}
          />

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

          <ReviewFormModal
            open={reviewOpen}
            target={reviewTarget}
            onOpenChange={setReviewOpen}
          />
        </VStack>
      )}
    </ContentLayout>
  );
}

function OrderContent({
  orderType,
  item,
}: {
  orderType: string;
  item: OrderItemOut;
}) {
  const content = decodeOrderItemContent(
    orderType,
    item.item_data,
    item.quantity,
  );
  const imageKey = repairImageKey(item.item_data);
  if (!content && !imageKey) return null;
  return (
    <VStack gap="x3" alignItems="stretch">
      <Text as="h3" textStyle="labelSm">
        주문 내용
      </Text>
      {content?.rows.map((row) => (
        <InfoRow key={row.label} label={row.label} value={row.value} />
      ))}
      {content && content.tags.length > 0 ? (
        <TagGroup>
          {content.tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </TagGroup>
      ) : null}
      {content?.memo ? (
        <VStack gap="x1">
          <Text textStyle="labelSm" color="fg.neutral-muted">
            요청사항
          </Text>
          <Text textStyle="bodySm">{content.memo}</Text>
        </VStack>
      ) : null}
      {imageKey ? (
        <Grid columns={{ base: 2, md: 3 }} gap="x3">
          <SignedOrderImage
            alt="수선 접수 사진"
            load={async () => {
              const response = await createReadUrl({
                body: { object_key: imageKey },
                throwOnError: true,
              });
              return response.data.read_url;
            }}
          />
        </Grid>
      ) : null}
    </VStack>
  );
}

function repairImageKey(itemData: unknown): string | null {
  if (!itemData || typeof itemData !== "object" || !("tie" in itemData))
    return null;
  const tie = itemData.tie;
  if (!tie || typeof tie !== "object" || !("image" in tie)) return null;
  const image = tie.image;
  if (!image || typeof image !== "object" || !("object_key" in image))
    return null;
  return typeof image.object_key === "string" ? image.object_key : null;
}

function OrderReferenceImages({
  orderId,
  show,
  images,
  pending,
  error,
  onRetry,
}: {
  orderId: string;
  show: boolean;
  images: OrderReferenceImageOut[] | undefined;
  pending: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  if (!show) return null;
  if (pending) return <Skeleton width="100%" height={180} />;
  if (error) {
    return (
      <Callout
        role="alert"
        tone="critical"
        title="참고 이미지를 불러오지 못했습니다"
        description="잠시 후 다시 시도해 주세요."
      >
        <ActionButton size="small" variant="neutralOutline" onClick={onRetry}>
          다시 시도
        </ActionButton>
      </Callout>
    );
  }
  if (!images?.length) return null;
  return (
    <VStack gap="x3" alignItems="stretch">
      <Text as="h2" textStyle="title3">
        참고 이미지
      </Text>
      <Grid columns={{ base: 2, md: 3 }} gap="x3">
        {images.map((image, index) => (
          <SignedOrderImage
            key={image.id}
            alt={`주문 참고 이미지 ${index + 1}`}
            load={async () => {
              const response = await createMyOrderReferenceImageReadUrl({
                path: { order_id: orderId, image_id: image.id },
                throwOnError: true,
              });
              return response.data.read_url;
            }}
          />
        ))}
      </Grid>
    </VStack>
  );
}

function RepairReceipt({
  orderId,
  receipt,
}: {
  orderId: string;
  receipt: RepairShippingReceiptOut;
}) {
  const reason = receipt.reason
    ? ({ quick: "퀵서비스", overseas: "해외 발송", lost: "송장 분실" }[
        receipt.reason
      ] ?? receipt.reason)
    : null;
  return (
    <Box
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="r3"
      p="x4"
    >
      <VStack gap="x3" alignItems="stretch">
        <Text as="h3" textStyle="labelSm">
          {receipt.receipt_type === "tracking" ? "송장 등록" : "송장 없이 발송"}
        </Text>
        {reason ? <InfoRow label="사유" value={reason} /> : null}
        <InfoRow label="접수 시각" value={formatDate(receipt.created_at)} />
        {receipt.memo ? (
          <VStack gap="x1">
            <Text textStyle="labelSm" color="fg.neutral-muted">
              발송 메모
            </Text>
            <Text textStyle="bodySm">{receipt.memo}</Text>
          </VStack>
        ) : null}
        {receipt.photo_count > 0 ? (
          <RepairReceiptPhotos orderId={orderId} receipt={receipt} />
        ) : null}
      </VStack>
    </Box>
  );
}

function RepairReceiptPhotos({
  orderId,
  receipt,
}: {
  orderId: string;
  receipt: RepairShippingReceiptOut;
}) {
  const query = useQuery({
    ...listMyRepairReceiptPhotosOptions({
      path: { order_id: orderId, receipt_id: receipt.id },
    }),
  });
  if (query.isPending) return <Skeleton width="100%" height={160} />;
  if (query.isError) {
    return (
      <Callout
        role="alert"
        tone="critical"
        title="발송 사진을 불러오지 못했습니다"
        description="잠시 후 다시 시도해 주세요."
      >
        <ActionButton
          size="small"
          variant="neutralOutline"
          onClick={() => void query.refetch()}
        >
          다시 시도
        </ActionButton>
      </Callout>
    );
  }
  return (
    <Grid columns={{ base: 2, md: 3 }} gap="x3">
      {(query.data ?? []).map((image, index) => (
        <SignedOrderImage
          key={image.id}
          alt={`수선 발송 사진 ${index + 1}`}
          load={async () => {
            const response = await createMyRepairReceiptPhotoReadUrl({
              path: {
                order_id: orderId,
                receipt_id: receipt.id,
                image_id: image.id,
              },
              throwOnError: true,
            });
            return response.data.read_url;
          }}
        />
      ))}
    </Grid>
  );
}

function SignedOrderImage({
  alt,
  load,
}: {
  alt: string;
  load: () => Promise<string>;
}) {
  const [readUrl, setReadUrl] = useState<string>();
  const mutation = useMutation({ mutationFn: load, onSuccess: setReadUrl });
  return (
    <VStack gap="x2" alignItems="stretch">
      <ImageFrame src={readUrl} alt={alt} ratio={1} fit="contain" stroke />
      <ActionButton
        type="button"
        size="small"
        variant="neutralOutline"
        loading={mutation.isPending}
        onClick={() =>
          readUrl
            ? window.open(readUrl, "_blank", "noopener,noreferrer")
            : mutation.mutate()
        }
      >
        {readUrl ? "원본 보기" : "이미지 보기"}
      </ActionButton>
      {mutation.isError ? (
        <Text role="alert" textStyle="caption" color="fg.critical">
          이미지를 불러오지 못했습니다.
        </Text>
      ) : null}
    </VStack>
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
              발송 등록일 {formatDate(shippedAt)}
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

function orderItemTitle(item: OrderItemOut): string {
  const data = item.item_data;
  if (
    item.item_type === "reform" &&
    data &&
    typeof data === "object" &&
    "tie" in data
  ) {
    try {
      const label = reformServiceLabel(
        data as unknown as Parameters<typeof reformServiceLabel>[0],
      );
      if (label) return `넥타이 수선 — ${label}`;
    } catch {
      // 형태가 다른 이관 데이터는 기본 라벨로 표시한다.
    }
  }
  return claimItemTitle(item);
}

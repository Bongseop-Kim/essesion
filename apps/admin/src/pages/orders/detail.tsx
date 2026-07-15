import type {
  AdminAction,
  AdminOrderReferenceImageOut,
  AdminRepairPhotoOut,
  ClaimBadgeOut,
  OrderItemOut,
  RepairShippingReceiptOut,
} from "@essesion/api-client";
import {
  adminUpdateOrderStatusMutation,
  adminUpdateOrderTrackingMutation,
  createAdminOrderReferenceImageReadUrlMutation,
  createAdminRepairReceiptPhotoReadUrlMutation,
  getAdminOrderOptions,
  getAdminOrderQueryKey,
  listAdminOrderReferenceImagesOptions,
  listAdminRepairReceiptPhotosOptions,
  listAllOrdersQueryKey,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Badge,
  Box,
  Callout,
  ContentPlaceholder,
  claimBadge,
  decodeOrderItemContent,
  Grid,
  HStack,
  ImageFrame,
  Skeleton,
  snackbar,
  Tag,
  TagGroup,
  Text,
  TextAreaField,
  TextField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import {
  formatDateTime,
  formatFileSize,
  formatIdentifier,
  formatMoney,
  formatOrderType,
  getErrorMessage,
} from "../../shared/lib/format";
import { RouteHeading } from "../../shared/ui/route-heading";
import {
  AdminTable,
  type AdminTableColumn,
} from "../../widgets/admin-table/admin-table";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

type DetailItem = {
  label: ReactNode;
  value: ReactNode;
};

function DetailSection({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Box
      as="section"
      bg="bg.layer-default"
      borderRadius="r3"
      p={{ base: "x4", md: "x5" }}
      className="border border-stroke-neutral-weak"
    >
      <VStack gap="x4" alignItems="stretch">
        <HStack justify="space-between" align="flex-start" gap="x4">
          <VStack gap="x1" minWidth={0}>
            <Text as="h2" textStyle="title3">
              {title}
            </Text>
            {description !== undefined ? (
              <Text textStyle="bodySm" color="fg.neutral-muted">
                {description}
              </Text>
            ) : null}
          </VStack>
        </HStack>
        {children}
      </VStack>
    </Box>
  );
}

function DetailGrid({ items }: { items: readonly DetailItem[] }) {
  return (
    <Grid as="dl" columns={{ base: 1, md: 2 }} gap="x4">
      {items.map((item, index) => (
        <VStack as="div" key={index} gap="x1" minWidth={0}>
          <Text as="dt" textStyle="caption" color="fg.neutral-muted">
            {item.label}
          </Text>
          <Box as="dd" className="m-0 break-words">
            <Text as="span" textStyle="bodySm">
              {item.value}
            </Text>
          </Box>
        </VStack>
      ))}
    </Grid>
  );
}

function PrivateImagePreview({
  src,
  alt,
  metadata,
  loading,
  error,
  errorDescription,
  onRequest,
}: {
  src?: string;
  alt: string;
  metadata: ReactNode;
  loading: boolean;
  error: boolean;
  errorDescription: string;
  onRequest: () => void;
}) {
  return (
    <VStack gap="x2" alignItems="stretch">
      {src ? (
        <ImageFrame src={src} alt={alt} ratio={4 / 3} fit="contain" stroke />
      ) : (
        <Box
          bg="bg.neutral-weak"
          borderRadius="r2"
          p="x6"
          className="grid min-h-32 place-items-center"
        >
          <Text color="fg.neutral-muted">미리보기 URL을 요청해 주세요.</Text>
        </Box>
      )}
      <HStack gap="x2" justify="space-between" wrap>
        <Text textStyle="caption" color="fg.neutral-muted">
          {metadata}
        </Text>
        <ActionButton
          size="small"
          variant="neutralOutline"
          loading={loading}
          onClick={onRequest}
        >
          {src ? "URL 재발급" : "이미지 보기"}
        </ActionButton>
      </HStack>
      {error ? (
        <Callout
          role="alert"
          tone="critical"
          title="이미지를 불러오지 못했습니다"
          description={errorDescription}
        />
      ) : null}
    </VStack>
  );
}

const positiveStatuses = new Set([
  "완료",
  "배송완료",
  "sent",
  "resolved",
  "active",
]);
const criticalStatuses = new Set([
  "실패",
  "거부",
  "취소",
  "failed",
  "inactive",
]);
const warningStatuses = new Set([
  "대기중",
  "답변대기",
  "접수",
  "pending",
  "open",
]);

function OrderStatusBadge({ status }: { status: string }) {
  const tone = positiveStatuses.has(status)
    ? "positive"
    : criticalStatuses.has(status)
      ? "critical"
      : warningStatuses.has(status)
        ? "warning"
        : "informative";
  return <Badge tone={tone}>{status}</Badge>;
}

function OrderClaimBadge({ claim }: { claim: ClaimBadgeOut }) {
  const presentation = claimBadge(claim);
  return <Badge tone={presentation.tone}>{presentation.label}</Badge>;
}

function snapshotLabel(item: OrderItemOut) {
  const data = record(item.item_data);
  const product = record(data?.product_snapshot ?? data?.product);
  const option = record(data?.option_snapshot ?? data?.option);
  const productName = product?.name ?? data?.product_name ?? data?.name;
  const optionName = option?.name ?? data?.option_name;
  return (
    [productName, optionName]
      .filter(
        (value): value is string => typeof value === "string" && value !== "",
      )
      .join(" · ") || `${item.item_type} · ${item.item_id}`
  );
}

function repairReasonLabel(reason: string) {
  return (
    { quick: "퀵서비스", overseas: "해외 발송", lost: "송장 분실" }[reason] ??
    reason
  );
}

function AdminOrderContent({
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
  if (!content) return null;
  return (
    <Box
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="r2"
      p="x4"
    >
      <VStack gap="x3" alignItems="stretch">
        <Text as="h3" textStyle="label">
          {snapshotLabel(item)} · {content.typeLabel}
        </Text>
        {content.rows.length > 0 ? <DetailGrid items={content.rows} /> : null}
        {content.tags.length > 0 ? (
          <TagGroup>
            {content.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </TagGroup>
        ) : null}
        {content.memo ? (
          <Callout
            tone="informative"
            title="요청사항"
            description={content.memo}
          />
        ) : null}
      </VStack>
    </Box>
  );
}

function OrderReferenceImage({
  orderId,
  image,
  index,
}: {
  orderId: string;
  image: AdminOrderReferenceImageOut;
  index: number;
}) {
  const [readUrl, setReadUrl] = useState<string>();
  const mutation = useMutation({
    ...createAdminOrderReferenceImageReadUrlMutation(),
    onSuccess: (data) => setReadUrl(data.read_url),
  });

  return (
    <PrivateImagePreview
      src={readUrl}
      alt={`주문 첨부 이미지 ${index + 1}`}
      metadata={
        <>
          {image.content_type ?? "이미지"} ·{" "}
          {formatFileSize(image.size_bytes, "크기 미상")} ·{" "}
          {formatDateTime(image.created_at)}
        </>
      }
      loading={mutation.isPending}
      error={mutation.isError}
      errorDescription="만료되었거나 이 주문에 속하지 않은 이미지입니다."
      onRequest={() =>
        mutation.mutate({
          path: { order_id: orderId, image_id: image.id },
        })
      }
    />
  );
}

function RepairReceiptPhoto({
  receiptId,
  image,
  index,
}: {
  receiptId: string;
  image: AdminRepairPhotoOut;
  index: number;
}) {
  const [readUrl, setReadUrl] = useState<string>();
  const mutation = useMutation({
    ...createAdminRepairReceiptPhotoReadUrlMutation(),
    onSuccess: (data) => setReadUrl(data.read_url),
  });

  return (
    <PrivateImagePreview
      src={readUrl}
      alt={`수선 발송 사진 ${index + 1}`}
      metadata={
        <>
          {image.content_type ?? "이미지"} ·{" "}
          {formatFileSize(image.size_bytes, "크기 미상")} ·{" "}
          {formatDateTime(image.created_at)}
        </>
      }
      loading={mutation.isPending}
      error={mutation.isError}
      errorDescription="만료되었거나 이 접수에 속하지 않은 이미지입니다."
      onRequest={() =>
        mutation.mutate({
          path: { receipt_id: receiptId, image_id: image.id },
        })
      }
    />
  );
}

function RepairReceiptPhotos({
  receipt,
}: {
  receipt: RepairShippingReceiptOut;
}) {
  const query = useQuery({
    ...listAdminRepairReceiptPhotosOptions({
      path: { receipt_id: receipt.id },
    }),
  });

  if (query.isPending) return <Skeleton width="100%" height={180} />;
  if (query.isError) {
    return (
      <ContentPlaceholder
        title="발송 사진을 불러오지 못했습니다"
        action={
          <ActionButton
            variant="neutralOutline"
            onClick={() => void query.refetch()}
          >
            다시 시도
          </ActionButton>
        }
      />
    );
  }
  if (query.data.length === 0) {
    return (
      <Text color="fg.neutral-muted">표시할 수 있는 발송 사진이 없습니다.</Text>
    );
  }
  return (
    <VStack gap="x5" alignItems="stretch">
      {query.data.map((image, index) => (
        <RepairReceiptPhoto
          key={image.id}
          receiptId={receipt.id}
          image={image}
          index={index}
        />
      ))}
    </VStack>
  );
}

function itemColumns(): readonly AdminTableColumn<OrderItemOut>[] {
  return [
    {
      key: "item",
      header: "거래 시점 상품·옵션",
      render: snapshotLabel,
    },
    {
      key: "claim",
      header: "클레임",
      render: (item) =>
        item.claim ? <OrderClaimBadge claim={item.claim} /> : "-",
    },
    {
      key: "quantity",
      header: "수량",
      align: "end",
      render: (item) => `${item.quantity}개`,
    },
    {
      key: "unit_price",
      header: "단가",
      align: "end",
      render: (item) => formatMoney(item.unit_price),
    },
    {
      key: "discount",
      header: "할인",
      align: "end",
      visibility: "medium",
      render: (item) => formatMoney(item.line_discount_amount),
    },
  ];
}

export function OrderDetailPage() {
  const { orderId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({
    ...getAdminOrderOptions({ path: { order_id: orderId } }),
    enabled: orderId !== "",
  });
  const hasOrderImages =
    query.data?.order_type === "custom" ||
    query.data?.order_type === "sample" ||
    query.data?.order_type === "repair";
  const referenceImagesQuery = useQuery({
    ...listAdminOrderReferenceImagesOptions({
      path: { order_id: orderId },
    }),
    enabled: orderId !== "" && hasOrderImages,
  });
  const [selectedAction, setSelectedAction] = useState<AdminAction>();
  const [memo, setMemo] = useState("");
  const [courier, setCourier] = useState("");
  const [tracking, setTracking] = useState("");
  const [companyCourier, setCompanyCourier] = useState("");
  const [companyTracking, setCompanyTracking] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [validationError, setValidationError] = useState<string>();

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getAdminOrderQueryKey({ path: { order_id: orderId } }),
      }),
      queryClient.invalidateQueries({ queryKey: listAllOrdersQueryKey() }),
    ]);
  };

  const statusMutation = useMutation({
    ...adminUpdateOrderStatusMutation(),
    onSuccess: async () => {
      snackbar("주문 상태를 변경했습니다.");
      setSelectedAction(undefined);
      setMemo("");
      await refresh();
    },
  });
  const trackingMutation = useMutation({
    ...adminUpdateOrderTrackingMutation(),
    onSuccess: async () => {
      snackbar("송장 정보를 저장했습니다.");
      setSelectedAction(undefined);
      await refresh();
    },
  });

  const data = query.data;
  const actionPending = statusMutation.isPending || trackingMutation.isPending;

  const timeline = useMemo(
    () =>
      [...(data?.status_logs ?? [])].sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      ),
    [data?.status_logs],
  );

  if (query.isLoading) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading
          title="주문 상세"
          description="거래 시점 정보와 주문 처리 이력을 확인합니다."
        />
        <ContentPlaceholder title="주문 상세를 불러오고 있습니다" />
      </VStack>
    );
  }
  if (query.isError || data === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading
          title="주문 상세"
          description="거래 시점 정보와 주문 처리 이력을 확인합니다."
        />
        <ContentPlaceholder
          title="주문을 불러오지 못했습니다"
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

  const runStatusMutation = () => {
    if (
      selectedAction?.target_status === undefined ||
      selectedAction.target_status === null
    ) {
      return;
    }
    statusMutation.mutate({
      path: { order_id: data.id },
      body: {
        new_status: selectedAction.target_status,
        memo: memo.trim() || null,
        is_rollback: selectedAction.kind === "rollback",
      },
    });
  };

  const submitAction = (event: FormEvent) => {
    event.preventDefault();
    setValidationError(undefined);
    if (selectedAction?.kind === "update_tracking") {
      trackingMutation.mutate({
        path: { order_id: data.id },
        body: {
          courier_company: courier.trim() || null,
          tracking_number: tracking.trim() || null,
          company_courier_company: companyCourier.trim() || null,
          company_tracking_number: companyTracking.trim() || null,
        },
      });
      return;
    }
    if (selectedAction?.requires_memo && memo.trim().length < 3) {
      setValidationError("변경 사유를 3자 이상 입력해 주세요.");
      return;
    }
    if (selectedAction?.destructive) setConfirmOpen(true);
    else runStatusMutation();
  };

  const selectAction = (action: AdminAction) => {
    setSelectedAction(action);
    setValidationError(undefined);
    if (action.kind === "update_tracking") {
      setCourier(data.courier_company ?? "");
      setTracking(data.tracking_number ?? "");
      setCompanyCourier(data.company_courier_company ?? "");
      setCompanyTracking(data.company_tracking_number ?? "");
    }
  };
  const orderItems = data.items ?? [];

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title={`주문 ${data.order_number}`}
          description="거래 시점 스냅샷과 서버가 허용한 운영 액션을 확인합니다."
        />
        <HStack gap="x1" wrap>
          <OrderStatusBadge status={data.status} />
          {data.claim_summary ? (
            <OrderClaimBadge claim={data.claim_summary} />
          ) : null}
        </HStack>
      </HStack>

      {data.active_claim !== null && data.active_claim !== undefined && (
        <Callout
          tone="warning"
          title={`활성 클레임 ${data.active_claim.claim_number}`}
          description="클레임 처리 중에는 일부 주문 상태 변경이 차단됩니다."
          onClick={() => navigate(`/claims/${data.active_claim?.id}`)}
        />
      )}

      <DetailSection title="주문 정보">
        <DetailGrid
          items={[
            { label: "주문 유형", value: formatOrderType(data.order_type) },
            { label: "주문 상태", value: data.status },
            { label: "주문 금액", value: formatMoney(data.order_amount) },
            { label: "원금", value: formatMoney(data.original_price) },
            { label: "할인", value: formatMoney(data.total_discount) },
            { label: "배송비", value: formatMoney(data.shipping_cost) },
            {
              label: "결제 그룹",
              value: formatIdentifier(data.payment_group_id),
            },
            { label: "주문 시각", value: formatDateTime(data.created_at) },
          ]}
        />
      </DetailSection>

      <DetailSection title="고객·배송">
        <DetailGrid
          items={[
            { label: "고객", value: data.customer.name },
            { label: "이메일", value: formatIdentifier(data.customer.email) },
            { label: "전화번호", value: formatIdentifier(data.customer.phone) },
            {
              label: "받는 분",
              value: data.shipping_address?.recipient_name ?? "-",
            },
            ...(data.shipping_address?.recipient_phone
              ? [
                  {
                    label: "수령인 연락처",
                    value: data.shipping_address.recipient_phone,
                  },
                ]
              : []),
            {
              label: "배송 주소",
              value: data.shipping_address
                ? `${data.shipping_address.postal_code} ${data.shipping_address.address} ${data.shipping_address.address_detail ?? ""}`
                : "-",
            },
            {
              label: "고객 송장",
              value:
                [data.courier_company, data.tracking_number]
                  .filter(Boolean)
                  .join(" · ") || "-",
            },
            {
              label: "회사 송장",
              value:
                [data.company_courier_company, data.company_tracking_number]
                  .filter(Boolean)
                  .join(" · ") || "-",
            },
            ...(data.shipping_address?.delivery_request
              ? [
                  {
                    label: "배송 요청",
                    value: data.shipping_address.delivery_request,
                  },
                ]
              : []),
            ...(data.shipping_address?.delivery_memo
              ? [
                  {
                    label: "배송 메모",
                    value: data.shipping_address.delivery_memo,
                  },
                ]
              : []),
          ]}
        />
      </DetailSection>

      {data.repair_pickup ? (
        <DetailSection title="수선 수거 요청">
          <DetailGrid
            items={[
              {
                label: "수거 대상",
                value: `${data.repair_pickup.recipient_name} · ${data.repair_pickup.recipient_phone}`,
              },
              {
                label: "수거지",
                value:
                  `${data.repair_pickup.postal_code ?? ""} ${data.repair_pickup.address} ${data.repair_pickup.detail_address ?? ""}`.trim(),
              },
              {
                label: "수거 비용",
                value: formatMoney(data.repair_pickup.pickup_fee),
              },
              {
                label: "요청 시각",
                value: formatDateTime(data.repair_pickup.created_at),
              },
            ]}
          />
        </DetailSection>
      ) : null}

      {(data.repair_receipts ?? []).length > 0 ? (
        <DetailSection title="수선 발송 접수">
          <VStack gap="x3" alignItems="stretch">
            {(data.repair_receipts ?? []).map((receipt) => (
              <Box
                key={receipt.id}
                borderWidth={1}
                borderColor="stroke.neutral-weak"
                borderRadius="r2"
                p="x4"
              >
                <VStack gap="x3" alignItems="stretch">
                  <DetailGrid
                    items={[
                      {
                        label: "발송 방식",
                        value:
                          receipt.receipt_type === "tracking"
                            ? "송장 등록"
                            : "송장 없이 발송",
                      },
                      ...(receipt.reason
                        ? [
                            {
                              label: "사유",
                              value: repairReasonLabel(receipt.reason),
                            },
                          ]
                        : []),
                      { label: "첨부 사진", value: `${receipt.photo_count}장` },
                      {
                        label: "접수 시각",
                        value: formatDateTime(receipt.created_at),
                      },
                    ]}
                  />
                  {receipt.memo ? (
                    <Callout
                      tone="informative"
                      title="발송 메모"
                      description={receipt.memo}
                    />
                  ) : null}
                  {receipt.photo_count > 0 ? (
                    <RepairReceiptPhotos receipt={receipt} />
                  ) : null}
                </VStack>
              </Box>
            ))}
          </VStack>
        </DetailSection>
      ) : null}

      <DetailSection
        title="주문 항목"
        description="상품·옵션·쿠폰은 주문 생성 시점 스냅샷을 우선합니다."
      >
        <AdminTable
          label="주문 항목"
          columns={itemColumns()}
          rows={orderItems}
          getRowKey={(row) => row.id}
          status="success"
        />
        <VStack gap="x3" alignItems="stretch">
          {orderItems.map((item) => (
            <AdminOrderContent
              key={item.id}
              orderType={data.order_type}
              item={item}
            />
          ))}
        </VStack>
      </DetailSection>

      {hasOrderImages && (
        <DetailSection
          title="첨부 이미지"
          description="주문 관계를 검증한 뒤 발급되는 짧은 수명의 읽기 URL만 사용합니다."
        >
          {referenceImagesQuery.isPending ? (
            <Skeleton width="100%" height={220} />
          ) : referenceImagesQuery.isError ? (
            <ContentPlaceholder
              title="참고 이미지를 불러오지 못했습니다"
              action={
                <ActionButton
                  variant="neutralOutline"
                  onClick={() => void referenceImagesQuery.refetch()}
                >
                  다시 시도
                </ActionButton>
              }
            />
          ) : (referenceImagesQuery.data ?? []).length === 0 ? (
            <Text color="fg.neutral-muted">등록된 첨부 이미지가 없습니다.</Text>
          ) : (
            <VStack gap="x5" alignItems="stretch">
              {(referenceImagesQuery.data ?? []).map((image, index) => (
                <OrderReferenceImage
                  key={image.id}
                  orderId={data.id}
                  image={image}
                  index={index}
                />
              ))}
            </VStack>
          )}
        </DetailSection>
      )}

      <DetailSection title="운영 액션">
        <VStack gap="x4" alignItems="stretch">
          <HStack gap="x2" wrap>
            {(data.admin_actions ?? []).map((action) => (
              <ActionButton
                key={`${action.kind}-${action.target_status ?? ""}`}
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
                key={action.label}
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
              {selectedAction.kind === "update_tracking" ? (
                <>
                  <TextField
                    label="택배사"
                    value={courier}
                    onChange={(event) => setCourier(event.currentTarget.value)}
                  />
                  <TextField
                    label="송장번호"
                    value={tracking}
                    onChange={(event) => setTracking(event.currentTarget.value)}
                  />
                  <TextField
                    label="회사 발송 택배사"
                    value={companyCourier}
                    onChange={(event) =>
                      setCompanyCourier(event.currentTarget.value)
                    }
                  />
                  <TextField
                    label="회사 발송 송장번호"
                    value={companyTracking}
                    onChange={(event) =>
                      setCompanyTracking(event.currentTarget.value)
                    }
                  />
                </>
              ) : (
                <TextAreaField
                  label={
                    selectedAction.requires_memo ? "변경 사유 (필수)" : "메모"
                  }
                  value={memo}
                  maxLength={500}
                  errorMessage={validationError}
                  onChange={(event) => setMemo(event.currentTarget.value)}
                />
              )}
              {(statusMutation.isError || trackingMutation.isError) && (
                <Callout
                  role="alert"
                  tone="critical"
                  title="작업을 완료하지 못했습니다"
                  description={getErrorMessage(
                    statusMutation.error ?? trackingMutation.error,
                    "현재 상태를 새로고침한 뒤 다시 시도해 주세요.",
                  )}
                />
              )}
              <HStack gap="x2">
                <ActionButton type="submit" loading={actionPending}>
                  저장
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
      </DetailSection>

      {data.related_orders !== undefined && data.related_orders.length > 0 && (
        <DetailSection title="같은 결제 그룹 주문">
          <VStack gap="x2">
            {data.related_orders.map((order) => (
              <HStack key={order.id} justify="space-between" gap="x3">
                <Link to={`/orders/${order.id}`}>{order.order_number}</Link>
                <OrderStatusBadge status={order.status} />
              </HStack>
            ))}
          </VStack>
        </DetailSection>
      )}

      <DetailSection title="상태 변경 이력">
        {timeline.length === 0 ? (
          <Text color="fg.neutral-muted">기록된 상태 변경이 없습니다.</Text>
        ) : (
          <VStack as="ol" gap="x3" alignItems="stretch">
            {timeline.map((log) => (
              <VStack
                as="li"
                key={log.id}
                gap="x1"
                className="border-l-2 border-stroke-neutral-weak pl-x4"
              >
                <Text textStyle="labelSm">
                  {log.previous_status} → {log.new_status}
                  {log.is_rollback ? " (롤백)" : ""}
                </Text>
                <Text textStyle="bodySm" color="fg.neutral-muted">
                  {log.memo ?? "메모 없음"}
                </Text>
                <Text textStyle="caption" color="fg.neutral-muted">
                  {formatDateTime(log.created_at)} · 처리자{" "}
                  {formatIdentifier(log.changed_by)}
                </Text>
              </VStack>
            ))}
          </VStack>
        )}
      </DetailSection>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`${selectedAction?.label ?? "위험 작업"}을 실행할까요?`}
        description={`주문 ${data.order_number}의 상태와 운영 이력에 반영됩니다. 입력한 사유: ${memo.trim() || "없음"}`}
        primaryActionProps={{
          children: "실행",
          variant: "criticalSolid",
          loading: statusMutation.isPending,
          onClick: runStatusMutation,
        }}
        secondaryActionProps={{ children: "취소" }}
      />
    </VStack>
  );
}

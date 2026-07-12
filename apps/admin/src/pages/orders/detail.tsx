import type {
  AdminAction,
  AdminOrderReferenceImageOut,
  OrderItemOut,
} from "@essesion/api-client";
import {
  adminUpdateOrderStatusMutation,
  adminUpdateOrderTrackingMutation,
  createAdminOrderReferenceImageReadUrlMutation,
  getAdminOrderOptions,
  getAdminOrderQueryKey,
  listAdminOrderReferenceImagesOptions,
  listAllOrdersQueryKey,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Callout,
  ContentPlaceholder,
  HStack,
  Skeleton,
  snackbar,
  Text,
  TextAreaField,
  TextField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import {
  formatDateTime,
  formatFileSize,
  formatIdentifier,
  formatMoney,
  getErrorMessage,
} from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { DetailList } from "../../shared/ui/detail-list";
import { PrivateAssetPreview } from "../../shared/ui/private-asset-preview";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";
import {
  AdminTable,
  type AdminTableColumn,
} from "../../widgets/admin-table/admin-table";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
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

const optionLabels: Record<string, string> = {
  fabric_provided: "원단 제공",
  reorder: "재주문",
  fabric_type: "원단",
  design_type: "디자인",
  tie_type: "타이 방식",
  interlining: "심지",
  size_type: "사이즈",
  tie_width: "타이 폭",
  triangle_stitch: "삼각 봉제",
  side_stitch: "옆선 봉제",
  bar_tack: "바텍",
  fold7: "7폴드",
  dimple: "딤플",
  turn_knot: "턴 노트",
  spoderato: "스포데라토",
  brand_label: "브랜드 라벨",
  care_label: "케어 라벨",
};

function optionSummary(item: OrderItemOut | undefined) {
  const options = record(record(item?.item_data)?.options);
  if (options === null) return "-";
  const values = Object.entries(optionLabels).flatMap(([key, label]) => {
    const value = options[key];
    if (value === null || value === undefined || value === "") return [];
    if (typeof value === "boolean")
      return [`${label}: ${value ? "예" : "아니오"}`];
    if (typeof value === "string" || typeof value === "number") {
      return [`${label}: ${value}`];
    }
    return [];
  });
  return values.join(" · ") || "-";
}

function productionTypeLabel(
  orderType: string,
  item: OrderItemOut | undefined,
) {
  if (orderType === "custom") return "맞춤 제작";
  const sampleType = record(item?.item_data)?.sample_type;
  const label =
    sampleType === "fabric"
      ? "원단 샘플"
      : sampleType === "sewing"
        ? "봉제 샘플"
        : sampleType === "fabric_and_sewing"
          ? "원단 + 봉제 샘플"
          : "샘플 제작";
  return label;
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
    <PrivateAssetPreview
      src={readUrl}
      alt={`주문 참고 이미지 ${index + 1}`}
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

const itemColumns: readonly AdminTableColumn<OrderItemOut>[] = [
  {
    key: "item",
    header: "거래 시점 상품·옵션",
    render: snapshotLabel,
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

export function OrderDetailPage() {
  const { orderId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({
    ...getAdminOrderOptions({ path: { order_id: orderId } }),
    enabled: orderId !== "",
  });
  const isProductionOrder =
    query.data?.order_type === "custom" || query.data?.order_type === "sample";
  const referenceImagesQuery = useQuery({
    ...listAdminOrderReferenceImagesOptions({
      path: { order_id: orderId },
    }),
    enabled: orderId !== "" && isProductionOrder,
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
  const productionItem = orderItems[0];
  const productionData = record(productionItem?.item_data);
  const additionalNotes =
    typeof productionData?.additional_notes === "string" &&
    productionData.additional_notes.trim() !== ""
      ? productionData.additional_notes
      : "-";

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title={`주문 ${data.order_number}`}
          description="거래 시점 스냅샷과 서버가 허용한 운영 액션을 확인합니다."
        />
        <StatusBadge status={data.status} />
      </HStack>

      {data.active_claim !== null && data.active_claim !== undefined && (
        <Callout
          tone="warning"
          title={`활성 클레임 ${data.active_claim.claim_number}`}
          description="클레임 처리 중에는 일부 주문 상태 변경이 차단됩니다."
          onClick={() => navigate(`/claims/${data.active_claim?.id}`)}
        />
      )}

      <AdminCard title="주문 정보">
        <DetailList
          items={[
            { label: "주문 유형", value: data.order_type },
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
      </AdminCard>

      <AdminCard title="고객·배송">
        <DetailList
          items={[
            { label: "고객", value: data.customer.name },
            { label: "이메일", value: formatIdentifier(data.customer.email) },
            { label: "전화번호", value: formatIdentifier(data.customer.phone) },
            {
              label: "받는 분",
              value: data.shipping_address?.recipient_name ?? "-",
            },
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
          ]}
        />
      </AdminCard>

      <AdminCard
        title="주문 항목"
        description="상품·옵션·쿠폰은 주문 생성 시점 스냅샷을 우선합니다."
      >
        <AdminTable
          label="주문 항목"
          columns={itemColumns}
          rows={orderItems}
          getRowKey={(row) => row.id}
          status="success"
        />
      </AdminCard>

      {isProductionOrder && (
        <AdminCard
          title="제작 주문 요약"
          description="허용된 제작 사양만 표시하며 비공개 저장소 키는 노출하지 않습니다."
        >
          <DetailList
            items={[
              {
                label: "제작 유형",
                value: productionTypeLabel(data.order_type, productionItem),
              },
              {
                label: "제작 수량",
                value: `${productionItem?.quantity ?? 0}개`,
              },
              { label: "제작 사양", value: optionSummary(productionItem) },
              { label: "추가 요청", value: additionalNotes },
              {
                label: "참고 이미지",
                value: referenceImagesQuery.isPending
                  ? "확인 중"
                  : `${referenceImagesQuery.data?.length ?? 0}개`,
              },
            ]}
          />
        </AdminCard>
      )}

      {isProductionOrder && (
        <AdminCard
          title="참고 이미지"
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
            <Text color="fg.neutral-muted">등록된 참고 이미지가 없습니다.</Text>
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
        </AdminCard>
      )}

      <AdminCard title="운영 액션">
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
      </AdminCard>

      {data.related_orders !== undefined && data.related_orders.length > 0 && (
        <AdminCard title="같은 결제 그룹 주문">
          <VStack gap="x2">
            {data.related_orders.map((order) => (
              <HStack key={order.id} justify="space-between" gap="x3">
                <Link to={`/orders/${order.id}`}>{order.order_number}</Link>
                <StatusBadge status={order.status} />
              </HStack>
            ))}
          </VStack>
        </AdminCard>
      )}

      <AdminCard title="상태 변경 이력">
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
      </AdminCard>

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

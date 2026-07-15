import type {
  AdminClaimAction,
  AdminClaimTrackingAction,
  AdminRepairPhotoOut,
  AdminTimelineEvent,
} from "@essesion/api-client";
import {
  adminApproveTokenRefundMutation,
  adminGetClaimOptions,
  adminGetClaimQueryKey,
  adminListClaimsV2QueryKey,
  adminRetryClaimNotificationMutation,
  adminUpdateClaimStatusMutation,
  adminUpdateClaimTrackingMutation,
  createAdminRepairReceiptPhotoReadUrlMutation,
  listAdminRepairReceiptPhotosOptions,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Box,
  Callout,
  ContentPlaceholder,
  Grid,
  HStack,
  ImageFrame,
  Skeleton,
  snackbar,
  TabContent,
  TabList,
  Tabs,
  TabTrigger,
  Text,
  TextAreaField,
  TextField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import {
  formatDateTime,
  formatFileSize,
  formatIdentifier,
  formatMoney,
  getErrorMessage,
} from "../../shared/lib/format";
import { useDirtyFormBlocker } from "../../shared/lib/use-dirty-form-blocker";
import { AdminCard } from "../../shared/ui/admin-card";
import { DetailList } from "../../shared/ui/detail-list";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";
import { TechnicalDetails } from "../../shared/ui/technical-details";

const CLAIM_TABS = ["overview", "shipping", "operations", "activity"] as const;

type ClaimTab = (typeof CLAIM_TABS)[number];

function claimTabFrom(
  params: URLSearchParams,
  hasShippingTab: boolean,
): ClaimTab {
  const value = params.get("tab");
  if (!CLAIM_TABS.includes(value as ClaimTab)) return "overview";
  if (value === "shipping" && !hasShippingTab) return "overview";
  return value as ClaimTab;
}

function claimTypeLabel(type: string) {
  const labels: Record<string, string> = {
    cancel: "취소",
    return: "반품",
    exchange: "교환",
    token_refund: "토큰 환불",
  };
  return labels[type] ?? type;
}

function claimReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    change_mind: "단순 변심",
    defect: "상품 불량",
    delay: "배송 지연",
    wrong_item: "다른 상품 배송",
    size_mismatch: "사이즈 불일치",
    color_mismatch: "색상 불일치",
    other: "기타",
    token_refund: "토큰 환불",
  };
  return labels[reason] ?? "기타 사유";
}

function repairReceiptTypeLabel(type: string) {
  const labels: Record<string, string> = {
    tracking: "송장 등록",
    no_tracking: "송장 없이 발송",
  };
  return labels[type] ?? "기타 발송 방식";
}

function timelineKey(event: AdminTimelineEvent, index: number) {
  return `${event.event_type}-${event.created_at}-${index}`;
}

function RepairReceiptPhoto({
  receiptId,
  photo,
  index,
}: {
  receiptId: string;
  photo: AdminRepairPhotoOut;
  index: number;
}) {
  const [readUrl, setReadUrl] = useState<string>();
  const mutation = useMutation({
    ...createAdminRepairReceiptPhotoReadUrlMutation(),
    onSuccess: (data) => setReadUrl(data.read_url),
  });

  return (
    <Box
      as="article"
      borderRadius="r2"
      p="x3"
      className="border border-stroke-neutral-weak"
    >
      <VStack gap="x3" alignItems="stretch">
        <ImageFrame
          src={readUrl}
          alt={`수선 배송 접수 사진 ${index + 1}`}
          ratio={4 / 3}
          fit="contain"
          stroke
        />
        <VStack gap="x0_5">
          <Text textStyle="labelSm">사진 {index + 1}</Text>
          <Text textStyle="caption" color="fg.neutral-muted">
            {photo.content_type ?? "이미지"} ·{" "}
            {formatFileSize(photo.size_bytes, "크기 정보 없음")}
          </Text>
          <Text textStyle="caption" color="fg.neutral-muted">
            {formatDateTime(photo.created_at)}
          </Text>
        </VStack>
        <ActionButton
          size="small"
          variant="neutralOutline"
          loading={mutation.isPending}
          onClick={() =>
            mutation.mutate({
              path: { receipt_id: receiptId, image_id: photo.id },
            })
          }
        >
          {readUrl === undefined ? "이미지 보기" : "URL 재발급"}
        </ActionButton>
        {mutation.isError && (
          <Callout
            role="alert"
            tone="critical"
            title="사진 URL을 발급하지 못했습니다"
            description="사진이 만료되었거나 이 수선 배송 접수와 연결되어 있지 않습니다."
          />
        )}
      </VStack>
    </Box>
  );
}

function RepairReceiptPhotos({ receiptId }: { receiptId: string }) {
  const query = useQuery({
    ...listAdminRepairReceiptPhotosOptions({
      path: { receipt_id: receiptId },
    }),
    enabled: receiptId !== "",
  });

  if (query.isLoading) {
    return (
      <Grid
        columns={{ base: 1, md: 3 }}
        gap="x3"
        aria-label="수선 배송 사진을 불러오는 중"
        aria-busy="true"
      >
        {[0, 1, 2].map((item) => (
          <Skeleton key={item} width="100%" height={220} />
        ))}
      </Grid>
    );
  }

  if (query.isError) {
    return (
      <ContentPlaceholder
        title="사진 목록을 불러오지 못했습니다"
        description="수선 배송 접수 관계를 다시 확인해 주세요."
        action={
          <ActionButton
            variant="neutralWeak"
            onClick={() => void query.refetch()}
          >
            다시 시도
          </ActionButton>
        }
      />
    );
  }

  if (query.data === undefined || query.data.length === 0) {
    return (
      <ContentPlaceholder
        title="등록된 사진이 없습니다"
        description="이 수선 배송 접수에 연결된 사진이 없습니다."
      />
    );
  }

  return (
    <Grid columns={{ base: 1, md: 3 }} gap="x3">
      {query.data.map((photo, index) => (
        <RepairReceiptPhoto
          key={photo.id}
          receiptId={receiptId}
          photo={photo}
          index={index}
        />
      ))}
    </Grid>
  );
}

function ClaimDetailLoading() {
  return (
    <VStack gap="x6" alignItems="stretch" aria-busy="true">
      <RouteHeading
        title="클레임 상세"
        description="클레임의 배송·알림·처리 이력을 확인합니다."
      />
      <AdminCard title="클레임 정보">
        <VStack gap="x3" alignItems="stretch">
          <Skeleton width="60%" height={24} />
          <Skeleton width="100%" height={20} />
          <Skeleton width="80%" height={20} />
        </VStack>
      </AdminCard>
      <AdminCard title="처리 이력">
        <Skeleton width="100%" height={96} />
      </AdminCard>
    </VStack>
  );
}

export function ClaimDetailPage() {
  const { claimId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const query = useQuery({
    ...adminGetClaimOptions({ path: { claim_id: claimId } }),
    enabled: claimId !== "",
  });
  const [selectedAction, setSelectedAction] = useState<AdminClaimAction>();
  const [memo, setMemo] = useState("");
  const [validationError, setValidationError] = useState<string>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [trackingAction, setTrackingAction] =
    useState<AdminClaimTrackingAction>();
  const [trackingCourier, setTrackingCourier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingMemo, setTrackingMemo] = useState("");
  const [trackingOperationId, setTrackingOperationId] = useState("");
  const [trackingValidationError, setTrackingValidationError] =
    useState<string>();

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: adminGetClaimQueryKey({ path: { claim_id: claimId } }),
      }),
      queryClient.invalidateQueries({ queryKey: adminListClaimsV2QueryKey() }),
    ]);
  };

  const statusMutation = useMutation({
    ...adminUpdateClaimStatusMutation(),
    onSuccess: async () => {
      snackbar("클레임 상태를 변경했습니다.");
      setSelectedAction(undefined);
      setMemo("");
      await refresh();
    },
  });
  const refundMutation = useMutation({
    ...adminApproveTokenRefundMutation(),
    onSuccess: async () => {
      snackbar("토큰 환불을 승인했습니다.");
      setSelectedAction(undefined);
      setMemo("");
      await refresh();
    },
  });
  const notificationMutation = useMutation({
    ...adminRetryClaimNotificationMutation(),
    onSuccess: async () => {
      snackbar("알림 발송을 다시 요청했습니다.");
      await refresh();
    },
  });
  const trackingMutation = useMutation({
    ...adminUpdateClaimTrackingMutation(),
    onSuccess: async () => {
      snackbar("클레임 송장 정보를 저장했습니다.");
      setTrackingAction(undefined);
      setTrackingCourier("");
      setTrackingNumber("");
      setTrackingMemo("");
      setTrackingOperationId("");
      await refresh();
    },
  });

  const data = query.data;
  const actionPending =
    statusMutation.isPending ||
    refundMutation.isPending ||
    trackingMutation.isPending;
  const trackingDirty =
    trackingAction !== undefined &&
    (trackingCourier !==
      (trackingAction.kind === "return"
        ? (data?.shipping.return_courier_company ?? "")
        : (data?.shipping.resend_courier_company ?? "")) ||
      trackingNumber !==
        (trackingAction.kind === "return"
          ? (data?.shipping.return_tracking_number ?? "")
          : (data?.shipping.resend_tracking_number ?? "")) ||
      trackingMemo !== "");
  const actionDirty = selectedAction !== undefined || trackingDirty;
  const blocker = useDirtyFormBlocker(actionDirty, undefined, true);
  const timeline = useMemo(
    () =>
      [...(data?.timeline ?? [])].sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      ),
    [data?.timeline],
  );

  if (query.isLoading) return <ClaimDetailLoading />;

  if (query.isError || data === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading
          title="클레임 상세"
          description="클레임의 배송·알림·처리 이력을 확인합니다."
        />
        <ContentPlaceholder
          title="클레임을 불러오지 못했습니다"
          description="클레임 ID를 확인하거나 다시 시도해 주세요."
          action={
            <ActionButton onClick={() => void query.refetch()}>
              다시 시도
            </ActionButton>
          }
        />
      </VStack>
    );
  }

  const runAction = () => {
    if (selectedAction === undefined || actionPending) return;
    if (selectedAction.kind === "approve_refund") {
      refundMutation.mutate({ path: { claim_id: data.id } });
      return;
    }
    if (
      selectedAction.target_status === null ||
      selectedAction.target_status === undefined
    ) {
      return;
    }
    statusMutation.mutate({
      path: { claim_id: data.id },
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
    if (selectedAction?.requires_memo && memo.trim().length < 3) {
      setValidationError("처리 사유를 3자 이상 입력해 주세요.");
      return;
    }
    if (selectedAction?.destructive) setConfirmOpen(true);
    else runAction();
  };

  const shippingAddress = data.shipping.shipping_address;
  const repairPickup = data.shipping.repair_pickup;
  const hasShippingTab = data.type === "return" || data.type === "exchange";
  const tab = claimTabFrom(params, hasShippingTab);
  const setTab = (next: string) => {
    const nextParams = new URLSearchParams(params);
    if (next === "overview") nextParams.delete("tab");
    else nextParams.set("tab", next);
    setParams(nextParams, { replace: true });
  };
  const shippingItems = [
    ...(shippingAddress
      ? [
          {
            label: "배송 주소",
            value:
              `${shippingAddress.postal_code} ${shippingAddress.address} ${shippingAddress.address_detail ?? ""}`.trim(),
          },
          {
            label: "수령인",
            value: `${shippingAddress.recipient_name} · ${shippingAddress.recipient_phone}`,
          },
        ]
      : []),
    ...[
      {
        label: "주문 배송",
        courier: data.shipping.order_courier_company,
        tracking: data.shipping.order_tracking_number,
      },
      {
        label: "업체 배송",
        courier: data.shipping.company_courier_company,
        tracking: data.shipping.company_tracking_number,
      },
      {
        label: "반송",
        courier: data.shipping.return_courier_company,
        tracking: data.shipping.return_tracking_number,
      },
      {
        label: "재발송",
        courier: data.shipping.resend_courier_company,
        tracking: data.shipping.resend_tracking_number,
      },
    ].flatMap(({ label, courier, tracking }) => {
      const value = [courier, tracking].filter(Boolean).join(" · ");
      return value === "" ? [] : [{ label, value }];
    }),
  ];

  const selectTrackingAction = (action: AdminClaimTrackingAction) => {
    setTrackingAction(action);
    setTrackingValidationError(undefined);
    setTrackingOperationId(crypto.randomUUID());
    setTrackingMemo("");
    trackingMutation.reset();
    if (action.kind === "return") {
      setTrackingCourier(data.shipping.return_courier_company ?? "");
      setTrackingNumber(data.shipping.return_tracking_number ?? "");
    } else {
      setTrackingCourier(data.shipping.resend_courier_company ?? "");
      setTrackingNumber(data.shipping.resend_tracking_number ?? "");
    }
  };

  const resetFailedTrackingOperation = () => {
    if (!trackingMutation.isError) return;
    setTrackingOperationId(crypto.randomUUID());
    trackingMutation.reset();
  };

  const submitTracking = (event: FormEvent) => {
    event.preventDefault();
    setTrackingValidationError(undefined);
    if (
      trackingAction === undefined ||
      trackingCourier.trim() === "" ||
      !/^[A-Za-z0-9-]{4,100}$/.test(trackingNumber.trim()) ||
      trackingMemo.trim().length < 3
    ) {
      setTrackingValidationError(
        "택배사, 영문·숫자·하이픈 송장번호, 3자 이상 변경 사유를 입력해 주세요.",
      );
      return;
    }
    trackingMutation.mutate({
      path: { claim_id: data.id },
      body: {
        operation_id: trackingOperationId,
        kind: trackingAction.kind,
        courier_company: trackingCourier.trim(),
        tracking_number: trackingNumber.trim(),
        memo: trackingMemo.trim(),
      },
    });
  };

  const selectPrimaryAction = (action: AdminClaimAction) => {
    setSelectedAction(action);
    setMemo("");
    setValidationError(undefined);
  };

  const cancelPrimaryAction = () => {
    setSelectedAction(undefined);
    setMemo("");
    setValidationError(undefined);
  };

  const actionPanel = (
    <AdminCard title="운영 액션">
      <VStack gap="x4" alignItems="stretch">
        <HStack gap="x2" wrap>
          {(data.admin_actions ?? []).map((action) => (
            <ActionButton
              key={`${action.kind}-${action.target_status ?? ""}`}
              variant={action.destructive ? "criticalSolid" : "neutralOutline"}
              disabled={!action.enabled || actionPending}
              title={action.blocking_reason ?? undefined}
              onClick={() => selectPrimaryAction(action)}
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
            {selectedAction.kind !== "approve_refund" && (
              <TextAreaField
                label={
                  selectedAction.requires_memo ? "처리 사유 (필수)" : "메모"
                }
                value={memo}
                maxLength={500}
                errorMessage={validationError}
                onChange={(event) => setMemo(event.currentTarget.value)}
              />
            )}
            {(statusMutation.isError || refundMutation.isError) && (
              <Callout
                role="alert"
                tone="critical"
                title="작업을 완료하지 못했습니다"
                description={getErrorMessage(
                  statusMutation.error ?? refundMutation.error,
                  "현재 상태를 새로고침한 뒤 다시 시도해 주세요.",
                )}
              />
            )}
            <HStack gap="x2">
              <ActionButton type="submit" loading={actionPending}>
                {selectedAction.destructive
                  ? `${selectedAction.label} 검토`
                  : selectedAction.label}
              </ActionButton>
              <ActionButton
                type="button"
                variant="ghost"
                disabled={actionPending}
                onClick={cancelPrimaryAction}
              >
                취소
              </ActionButton>
            </HStack>
          </VStack>
        )}
      </VStack>
    </AdminCard>
  );

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title={`클레임 ${data.claim_number}`}
          description="서버가 허용한 운영 액션과 배송·알림 상태를 확인합니다."
        />
        <StatusBadge status={data.status} />
      </HStack>

      {actionPanel}

      <Tabs value={tab} onValueChange={setTab}>
        <TabList aria-label="클레임 상세 메뉴">
          <TabTrigger value="overview" disabled={trackingAction !== undefined}>
            개요
          </TabTrigger>
          {hasShippingTab && (
            <TabTrigger value="shipping">배송·첨부</TabTrigger>
          )}
          <TabTrigger
            value="operations"
            disabled={trackingAction !== undefined}
          >
            알림·결제
          </TabTrigger>
          <TabTrigger value="activity" disabled={trackingAction !== undefined}>
            활동 이력
          </TabTrigger>
        </TabList>

        <TabContent value="overview">
          <VStack gap="x5" pt="x5" alignItems="stretch">
            <AdminCard title="클레임 정보">
              <DetailList
                items={[
                  { label: "유형", value: claimTypeLabel(data.type) },
                  { label: "상태", value: data.status },
                  { label: "사유", value: claimReasonLabel(data.reason) },
                  { label: "상세 사유", value: data.description ?? "-" },
                  { label: "수량", value: `${data.quantity}개` },
                  {
                    label: "접수 시각",
                    value: formatDateTime(data.created_at),
                  },
                  {
                    label: "수정 시각",
                    value: formatDateTime(data.updated_at),
                  },
                  {
                    label: "주문",
                    value: (
                      <Link to={`/orders/${data.order.id}`}>
                        {data.order.order_number}
                      </Link>
                    ),
                  },
                ]}
              />
            </AdminCard>

            <AdminCard title="고객·주문 항목">
              <DetailList
                items={[
                  { label: "고객", value: data.customer.name },
                  {
                    label: "이메일",
                    value: formatIdentifier(data.customer.email),
                  },
                  {
                    label: "전화번호",
                    value: formatIdentifier(data.customer.phone),
                  },
                  { label: "주문 상태", value: data.order.status },
                  { label: "주문 유형", value: data.order.order_type },
                  {
                    label: "주문 금액",
                    value: formatMoney(data.order.order_amount),
                  },
                  { label: "항목 유형", value: data.item.item_type },
                  { label: "항목 수량", value: `${data.item.quantity}개` },
                  { label: "단가", value: formatMoney(data.item.unit_price) },
                ]}
              />
            </AdminCard>
          </VStack>
        </TabContent>

        {hasShippingTab && (
          <TabContent value="shipping">
            <VStack gap="x5" pt="x5" alignItems="stretch">
              <AdminCard title="배송 정보">
                <VStack gap="x5" alignItems="stretch">
                  {shippingItems.length > 0 ? (
                    <DetailList items={shippingItems} />
                  ) : (
                    <Text color="fg.neutral-muted">
                      등록된 배송 정보가 없습니다.
                    </Text>
                  )}
                  {(data.tracking_actions ?? []).length > 0 && (
                    <VStack gap="x3" alignItems="stretch">
                      <Text as="h3" textStyle="label">
                        클레임 송장 수정
                      </Text>
                      <HStack gap="x2" wrap>
                        {(data.tracking_actions ?? []).map((action) => (
                          <ActionButton
                            key={action.kind}
                            size="small"
                            variant="neutralOutline"
                            disabled={
                              !action.enabled || trackingMutation.isPending
                            }
                            title={action.blocking_reason ?? undefined}
                            onClick={() => selectTrackingAction(action)}
                          >
                            {action.label}
                          </ActionButton>
                        ))}
                      </HStack>
                      {trackingAction !== undefined && (
                        <VStack
                          as="form"
                          gap="x3"
                          alignItems="stretch"
                          onSubmit={submitTracking}
                        >
                          <TextField
                            label="택배사"
                            value={trackingCourier}
                            maxLength={50}
                            onChange={(event) => {
                              resetFailedTrackingOperation();
                              setTrackingCourier(event.currentTarget.value);
                            }}
                          />
                          <TextField
                            label="송장번호"
                            value={trackingNumber}
                            maxLength={100}
                            onChange={(event) => {
                              resetFailedTrackingOperation();
                              setTrackingNumber(event.currentTarget.value);
                            }}
                          />
                          <TextAreaField
                            label="변경 사유"
                            value={trackingMemo}
                            maxLength={500}
                            errorMessage={trackingValidationError}
                            onChange={(event) => {
                              resetFailedTrackingOperation();
                              setTrackingMemo(event.currentTarget.value);
                            }}
                          />
                          {trackingMutation.isError && (
                            <Callout
                              role="alert"
                              tone="critical"
                              title="송장 정보를 저장하지 못했습니다"
                              description={getErrorMessage(
                                trackingMutation.error,
                                "현재 클레임 상태를 확인한 뒤 다시 시도해 주세요.",
                              )}
                            />
                          )}
                          <HStack gap="x2">
                            <ActionButton
                              type="submit"
                              loading={trackingMutation.isPending}
                            >
                              송장 저장
                            </ActionButton>
                            <ActionButton
                              type="button"
                              variant="ghost"
                              disabled={trackingMutation.isPending}
                              onClick={() => setTrackingAction(undefined)}
                            >
                              취소
                            </ActionButton>
                          </HStack>
                        </VStack>
                      )}
                    </VStack>
                  )}
                  {repairPickup !== null && (
                    <VStack gap="x2" alignItems="stretch">
                      <Text as="h3" textStyle="label">
                        수선 수거 요청
                      </Text>
                      <DetailList
                        items={[
                          {
                            label: "수거지",
                            value: `${repairPickup.postal_code ?? ""} ${repairPickup.address} ${repairPickup.detail_address ?? ""}`,
                          },
                          {
                            label: "수거 대상",
                            value: `${repairPickup.recipient_name} · ${repairPickup.recipient_phone}`,
                          },
                          {
                            label: "수거 비용",
                            value: formatMoney(repairPickup.pickup_fee),
                          },
                          {
                            label: "요청 시각",
                            value: formatDateTime(repairPickup.created_at),
                          },
                        ]}
                      />
                    </VStack>
                  )}
                  {(data.shipping.repair_receipts ?? []).length > 0 && (
                    <VStack gap="x2" alignItems="stretch">
                      <Text as="h3" textStyle="label">
                        수선 배송 접수
                      </Text>
                      {(data.shipping.repair_receipts ?? []).map((receipt) => (
                        <Box
                          as="section"
                          key={receipt.id}
                          borderRadius="r2"
                          p="x4"
                          className="border border-stroke-neutral-weak"
                        >
                          <VStack gap="x4" alignItems="stretch">
                            <HStack
                              justify="space-between"
                              align="flex-start"
                              gap="x3"
                              wrap
                            >
                              <VStack gap="x0_5">
                                <Text as="h4" textStyle="labelSm">
                                  {repairReceiptTypeLabel(receipt.receipt_type)}
                                </Text>
                                <Text textStyle="bodySm">
                                  {receipt.reason ?? "사유 없음"} · 사진{" "}
                                  {receipt.photo_count}장
                                </Text>
                                {receipt.memo !== null && (
                                  <Text
                                    textStyle="caption"
                                    color="fg.neutral-muted"
                                  >
                                    {receipt.memo}
                                  </Text>
                                )}
                              </VStack>
                              <Text
                                textStyle="caption"
                                color="fg.neutral-muted"
                              >
                                {formatDateTime(receipt.created_at)}
                              </Text>
                            </HStack>
                            <RepairReceiptPhotos receiptId={receipt.id} />
                          </VStack>
                        </Box>
                      ))}
                    </VStack>
                  )}
                </VStack>
              </AdminCard>
            </VStack>
          </TabContent>
        )}

        <TabContent value="operations">
          <VStack gap="x5" pt="x5" alignItems="stretch">
            <AdminCard title="알림 발송">
              {(data.notifications ?? []).length === 0 ? (
                <Text color="fg.neutral-muted">기록된 알림이 없습니다.</Text>
              ) : (
                <VStack gap="x3" alignItems="stretch">
                  {(data.notifications ?? []).map((notification) => (
                    <HStack
                      key={notification.id}
                      justify="space-between"
                      gap="x4"
                      wrap
                    >
                      <VStack gap="x0_5" minWidth={0}>
                        <HStack gap="x2">
                          <Text textStyle="labelSm">{notification.status}</Text>
                          <StatusBadge status={notification.delivery_status} />
                        </HStack>
                        <Text textStyle="caption" color="fg.neutral-muted">
                          시도 {notification.attempts}회 ·{" "}
                          {formatDateTime(notification.updated_at)}
                        </Text>
                        {notification.last_error !== null && (
                          <Text textStyle="caption" color="fg.critical">
                            {notification.last_error}
                          </Text>
                        )}
                      </VStack>
                      {(notification.delivery_status === "failed" ||
                        notification.delivery_status === "pending") && (
                        <ActionButton
                          size="small"
                          variant="neutralOutline"
                          loading={
                            notificationMutation.isPending &&
                            notificationMutation.variables?.path
                              .notification_id === notification.id
                          }
                          disabled={notificationMutation.isPending}
                          onClick={() =>
                            notificationMutation.mutate({
                              path: { notification_id: notification.id },
                            })
                          }
                        >
                          다시 발송
                        </ActionButton>
                      )}
                    </HStack>
                  ))}
                  {notificationMutation.isError && (
                    <Callout
                      role="alert"
                      tone="critical"
                      title="알림 재발송을 요청하지 못했습니다"
                      description={getErrorMessage(
                        notificationMutation.error,
                        "잠시 뒤 다시 시도해 주세요.",
                      )}
                    />
                  )}
                </VStack>
              )}
            </AdminCard>

            {(data.payment_incidents ?? []).length > 0 && (
              <AdminCard title="관련 결제 이상">
                <VStack gap="x2" alignItems="stretch">
                  {(data.payment_incidents ?? []).map((incident) => (
                    <HStack key={incident.id} justify="space-between" gap="x3">
                      <Link to={`/incidents/${incident.id}`}>
                        {incident.incident_type}
                      </Link>
                      <StatusBadge status={incident.status} />
                    </HStack>
                  ))}
                </VStack>
              </AdminCard>
            )}
          </VStack>
        </TabContent>

        <TabContent value="activity">
          <VStack gap="x5" pt="x5" alignItems="stretch">
            <AdminCard title="처리 타임라인">
              {timeline.length === 0 ? (
                <Text color="fg.neutral-muted">
                  기록된 처리 이력이 없습니다.
                </Text>
              ) : (
                <VStack as="ol" gap="x3" alignItems="stretch">
                  {timeline.map((event, index) => (
                    <VStack
                      as="li"
                      key={timelineKey(event, index)}
                      gap="x1"
                      className="border-l-2 border-stroke-neutral-weak pl-x4"
                    >
                      <Text textStyle="labelSm">{event.title}</Text>
                      {event.description !== null &&
                        event.description !== undefined && (
                          <Text textStyle="bodySm" color="fg.neutral-muted">
                            {event.description}
                          </Text>
                        )}
                      <Text textStyle="caption" color="fg.neutral-muted">
                        {formatDateTime(event.created_at)}
                      </Text>
                    </VStack>
                  ))}
                </VStack>
              )}
            </AdminCard>

            <TechnicalDetails
              json={{
                claim_id: data.id,
                reason_code: data.reason,
                customer_id: data.customer.id,
                order_id: data.order.id,
                payment_group_id: data.order.payment_group_id,
                item: {
                  row_id: data.item.id,
                  item_id: data.item.item_id,
                  product_id: data.item.product_id,
                  selected_option_id: data.item.selected_option_id,
                  applied_user_coupon_id: data.item.applied_user_coupon_id,
                  item_data: data.item.item_data,
                },
                refund_data: data.refund_data,
                repair_receipts: (data.shipping.repair_receipts ?? []).map(
                  (receipt) => ({
                    receipt_id: receipt.id,
                    receipt_type: receipt.receipt_type,
                  }),
                ),
                status_logs: data.status_logs,
                timeline: timeline.map((event) => ({
                  event_type: event.event_type,
                  actor_id: event.actor_id,
                  created_at: event.created_at,
                })),
              }}
            />
          </VStack>
        </TabContent>
      </Tabs>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`${selectedAction?.label ?? "위험 작업"}을 실행할까요?`}
        description={`클레임 ${data.claim_number} · ${selectedAction?.target_status ? `상태 ${data.status} → ${selectedAction.target_status}` : "환불 승인 결과 반영"} · 처리 사유: ${memo.trim() || "없음"}`}
        primaryActionProps={{
          children: selectedAction?.label ?? "작업 실행",
          variant: "criticalSolid",
          loading: actionPending,
          disabled: actionPending,
          onClick: runAction,
        }}
        secondaryActionProps={{ children: "취소", disabled: actionPending }}
      />
      <AlertDialog
        open={blocker.state === "blocked"}
        title="작성 중인 클레임 작업을 버릴까요?"
        description="저장하지 않은 처리 사유 또는 송장 정보가 사라집니다."
        primaryActionProps={{
          children: "클레임 작업 버리기",
          variant: "criticalSolid",
          onClick: () => blocker.proceed?.(),
        }}
        secondaryActionProps={{
          children: "계속 작성",
          onClick: () => blocker.reset?.(),
        }}
      />
    </VStack>
  );
}

import type { ManualOrderOut } from "@essesion/api-client";
import {
  createManualOrderImageReadUrlMutation,
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
  formatPhoneNumber,
  HStack,
  Skeleton,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";

import { downloadWorksheetPng } from "../../shared/lib/capture";
import {
  formatAmountBreakdown,
  formatDate,
  formatDateTime,
  formatFileSize,
} from "../../shared/lib/format";
import {
  type ManualOrderKind,
  manualOrderKind,
  manualOrderPath,
} from "../../shared/lib/manual-order-kind";
import { AdminCard } from "../../shared/ui/admin-card";
import { type DetailItem, DetailList } from "../../shared/ui/detail-list";
import { OptionPair } from "../../shared/ui/option-pair";
import { PrivateAssetPreview } from "../../shared/ui/private-asset-preview";
import { RouteHeading } from "../../shared/ui/route-heading";

type ManualOrderItemOut = ManualOrderOut["items"][number];

function itemCategoryLabel(item: ManualOrderItemOut) {
  const categories = [
    item.automatic != null && "자동수선",
    item.width != null && "폭수선",
    item.restoration != null && "복원수선",
    item.custom != null && "주문제작",
  ].filter((value): value is string => typeof value === "string");
  return categories.length === 0 ? "-" : categories.join(" · ");
}

function itemDetailItems(item: ManualOrderItemOut): DetailItem[] {
  const items: DetailItem[] = [
    { label: "수량", value: `${item.quantity.toLocaleString("ko-KR")}개` },
    { label: "대분류", value: itemCategoryLabel(item) },
  ];
  if (item.automatic != null) {
    // 라벨·선택지는 입력 폼(manual-order-form.tsx)의 SegmentedControl과 맞춘다.
    items.push(
      {
        label: "[자동] 타입",
        value: (
          <OptionPair
            options={["지퍼", "끈"]}
            selected={item.automatic.mechanism === "string" ? "끈" : "지퍼"}
          />
        ),
      },
      {
        label: "[자동] 마감",
        value: (
          <OptionPair
            options={["방", "돌려묶기"]}
            selected={item.automatic.turn_knot ? "돌려묶기" : "방"}
          />
        ),
      },
      {
        label: "[자동] 딤플",
        value: (
          <OptionPair
            options={["기본", "딤플"]}
            selected={item.automatic.dimple ? "딤플" : "기본"}
          />
        ),
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
  if (item.custom != null) {
    items.push(
      {
        label: "[제작] 원단",
        value: item.custom.fabric_provided
          ? "원단 제공"
          : `${item.custom.fabric_type === "SILK" ? "실크" : "폴리"} · ${
              item.custom.design_type === "YARN_DYED" ? "선염" : "날염"
            }`,
      },
      {
        label: "[제작] 봉제",
        value: (
          <OptionPair
            options={["수동", "자동"]}
            selected={item.custom.tie_type === "AUTO" ? "자동" : "수동"}
          />
        ),
      },
      {
        label: "[제작] 규격",
        value: item.custom.size_type === "CHILD" ? "아동용" : "성인용",
      },
    );
    // 수동 봉제는 마감·딤플이 선택 항목이 아니다(폼에서도 비활성) — 행 자체를 감춘다.
    if (item.custom.tie_type === "AUTO") {
      items.push(
        {
          label: "[제작] 마감",
          value: (
            <OptionPair
              options={["방", "돌려묶기"]}
              selected={item.custom.turn_knot ? "돌려묶기" : "방"}
            />
          ),
        },
        {
          label: "[제작] 딤플",
          value: (
            <OptionPair
              options={["기본", "딤플"]}
              selected={item.custom.dimple ? "딤플" : "기본"}
            />
          ),
        },
      );
    }
    if (item.custom.tie_width_cm != null) {
      items.push({
        label: "[제작] 타이 폭",
        value: `${item.custom.tie_width_cm}cm`,
      });
    }
    const memo = item.custom.memo ?? "";
    if (memo !== "") items.push({ label: "[제작] 내용", value: memo });
  }
  const note = item.note ?? "";
  if (note !== "") items.push({ label: "특이사항", value: note });
  return items;
}

function ManualOrderImage({
  manualOrderId,
  image,
  alt,
}: {
  manualOrderId: string;
  image: ManualOrderOut["images"][number];
  alt: string;
}) {
  const [readUrl, setReadUrl] = useState<string>();
  const mutation = useMutation({
    ...createManualOrderImageReadUrlMutation(),
    onSuccess: (data) => setReadUrl(data.read_url),
  });

  return (
    <PrivateAssetPreview
      src={readUrl}
      alt={alt}
      metadata={
        <>
          {image.content_type ?? "이미지"} ·{" "}
          {formatFileSize(image.size_bytes, "크기 미상")} ·{" "}
          {formatDateTime(image.created_at)}
        </>
      }
      error={mutation.isError}
      errorDescription="만료되었거나 이 주문에 속하지 않은 이미지입니다."
      onRequest={() =>
        mutation.mutate({
          path: { manual_order_id: manualOrderId, image_id: image.id },
        })
      }
    />
  );
}

const NOUN: Record<ManualOrderKind, string> = {
  custom: "수기 주문",
  repair: "수기 수선",
};

function ManualOrderDetailLoading({ noun }: { noun: string }) {
  return (
    <VStack gap="x6" alignItems="stretch" aria-busy="true">
      <RouteHeading
        title={`${noun} 상세`}
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

function ManualOrderDetail({ kind }: { kind: ManualOrderKind }) {
  const { manualOrderId = "" } = useParams();
  const noun = NOUN[kind];
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);
  const query = useQuery({
    ...getManualOrderOptions({ path: { manual_order_id: manualOrderId } }),
    enabled: manualOrderId !== "",
  });
  const deleteMutation = useMutation({
    ...deleteManualOrderMutation(),
    onSuccess: async () => {
      snackbar(`${noun}을 삭제했습니다.`);
      await queryClient.invalidateQueries({
        queryKey: listManualOrdersQueryKey(),
      });
      navigate("/manual-orders", { replace: true });
    },
    onError: () => {
      snackbar(`${noun}을 삭제하지 못했습니다.`);
    },
  });
  const order = query.data;

  if (query.isLoading) return <ManualOrderDetailLoading noun={noun} />;
  if (query.isError || order === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading
          title={`${noun} 상세`}
          description="작업지시서 내용을 확인합니다."
        />
        <ContentPlaceholder
          title={`${noun}을 불러오지 못했습니다`}
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

  // 다른 계열의 주소로 들어왔으면 제 화면으로 보낸다.
  const actualKind = manualOrderKind(order);
  if (actualKind !== kind) {
    return <Navigate to={manualOrderPath(actualKind, order.id)} replace />;
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
          title={`${order.customer_name} 님의 ${noun}`}
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
            onClick={() => navigate(manualOrderPath(kind, order.id, "edit"))}
          >
            수정
          </ActionButton>
          <ActionButton
            onClick={() => {
              const node = captureRef.current;
              if (node === null) return;
              void downloadWorksheetPng(
                node,
                `${noun.replace(" ", "")}_${order.customer_name}_${order.order_date}.png`,
              ).catch(() =>
                snackbar("작업지시서 이미지를 저장하지 못했습니다."),
              );
            }}
          >
            작업지시서 이미지 저장
          </ActionButton>
        </HStack>
      </HStack>

      {/* 캡처 대상. 버튼은 래퍼 밖에 두어 PNG에 찍히지 않게 한다. */}
      <Box ref={captureRef} data-capture>
        <VStack gap="x6" alignItems="stretch">
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
                { label: "휴대폰", value: formatPhoneNumber(order.phone) },
                {
                  label: "주소",
                  value:
                    order.address === null || order.address === ""
                      ? "-"
                      : order.address,
                },
                {
                  label: "원금 − 할인 + 택배비 = 주문 금액",
                  value: formatAmountBreakdown(
                    order.amount,
                    order.discount,
                    order.shipping_fee,
                  ),
                },
              ]}
            />
          </AdminCard>

          <AdminCard
            title={kind === "repair" ? "수선 품목" : "제작 품목"}
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
                      {(item.image_upload_ids ?? []).length > 0 && (
                        <HStack gap="x3" wrap alignItems="flex-start">
                          {order.images
                            .filter((i) =>
                              item.image_upload_ids?.includes(i.id),
                            )
                            .map((image, position) => (
                              <ManualOrderImage
                                key={image.id}
                                manualOrderId={order.id}
                                image={image}
                                alt={`품목 ${index + 1} 사진 ${position + 1}`}
                              />
                            ))}
                        </HStack>
                      )}
                    </VStack>
                  </Box>
                ))}
              </VStack>
            )}
          </AdminCard>
        </VStack>
      </Box>

      <HStack justify="flex-end">
        <ActionButton
          variant="criticalSolid"
          loading={deleteMutation.isPending}
          onClick={() => setDeleteConfirmOpen(true)}
        >
          {noun} 삭제
        </ActionButton>
      </HStack>

      <AlertDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={`이 ${noun}을 삭제할까요?`}
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

export function ManualOrderDetailPage() {
  return <ManualOrderDetail kind="custom" />;
}

export function ManualRepairDetailPage() {
  return <ManualOrderDetail kind="repair" />;
}

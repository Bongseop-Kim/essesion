import {
  getOrderOptions,
  getOrderQueryKey,
  listMyOrdersQueryKey,
} from "@essesion/api-client/query";
import {
  ActionButton,
  Badge,
  ContentPlaceholder,
  HStack,
  SelectBox,
  SelectBoxItem,
  Skeleton,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router";
import { orderStatusTone } from "@/features/orders";
import {
  isRepairShipmentDraft,
  type RepairShipmentDraft,
  RepairShipmentFields,
  shipmentDraftFromForm,
  shipmentFormFromDraft,
  shipmentInvalidReason,
  submitRepairShipment,
} from "@/features/repair-shipping";
import { ContentLayout } from "@/shared/ui/content-layout";

export function RepairShippingPage() {
  const { orderId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const orderQuery = useQuery({
    ...getOrderOptions({ path: { order_id: orderId ?? "" } }),
    enabled: !!orderId,
  });
  const statePrefill = (location.state as { prefill?: unknown } | null)
    ?.prefill;
  const prefill = isRepairShipmentDraft(statePrefill) ? statePrefill : null;
  const [form, setForm] = useState(() => shipmentFormFromDraft(prefill));
  const [uploading, setUploading] = useState(false);
  // prefill이 있다면 체크아웃에서 이미 발송 선언을 한 사용자 — 확인을 미리 체크
  const [confirmedShipment, setConfirmedShipment] = useState(!!prefill);
  const submit = useMutation({
    mutationFn: (draft: RepairShipmentDraft) =>
      submitRepairShipment(orderId ?? "", draft),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getOrderQueryKey({ path: { order_id: orderId ?? "" } }),
      });
      await queryClient.invalidateQueries({
        queryKey: listMyOrdersQueryKey(),
      });
      snackbar("발송 정보를 등록했습니다.");
      navigate(`/order/${orderId}`, { replace: true });
    },
    onError: () => {
      snackbar("발송 정보를 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      // 다른 탭에서 이미 등록된 경우(invalid_status) — 상태가 바뀌었으면 아래 가드가 상세로 보낸다
      void orderQuery.refetch();
    },
  });

  if (!orderId) return <Navigate to="/my-page/orders" replace />;

  const order = orderQuery.data;
  if (order && (order.order_type !== "repair" || order.status !== "발송대기")) {
    return <Navigate to={`/order/${orderId}`} replace />;
  }

  const draft = shipmentDraftFromForm(form);
  const invalidReason = uploading
    ? "발송 사진을 업로드하는 중입니다."
    : shipmentInvalidReason(form);

  return (
    <ContentLayout
      breadcrumbs={[
        { label: "홈", href: "/" },
        { label: "주문 내역", href: "/my-page/orders" },
        { label: "발송 확인" },
      ]}
    >
      {orderQuery.isPending ? (
        <VStack gap="x4" alignItems="stretch">
          <Skeleton width="40%" height={32} />
          <Skeleton width="100%" height={48} />
          <Skeleton width="100%" height={200} />
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
            <Text as="h1" textStyle="title1">
              발송 확인
            </Text>
            <HStack gap="x2">
              <Text textStyle="caption" color="fg.neutral-muted">
                수선 주문 {order.order_number}
              </Text>
              <Badge tone={orderStatusTone(order.status)}>{order.status}</Badge>
            </HStack>
          </VStack>

          <SelectBox
            multiple
            value={confirmedShipment ? ["confirmed"] : []}
            onValueChange={(value) =>
              setConfirmedShipment(
                Array.isArray(value)
                  ? value.includes("confirmed")
                  : value === "confirmed",
              )
            }
            aria-label="발송 확인"
          >
            <SelectBoxItem
              value="confirmed"
              label="수선품을 발송했습니다."
              description="송장번호와 사진은 선택이지만, 입력해 두면 확인이 정확해집니다."
              disabled={submit.isPending}
            />
          </SelectBox>

          {confirmedShipment ? (
            <RepairShipmentFields
              state={form}
              onChange={setForm}
              onUploadingChange={setUploading}
              disabled={submit.isPending}
            />
          ) : null}

          <VStack gap="x3" alignItems="stretch">
            <ActionButton
              type="button"
              size="large"
              loading={submit.isPending}
              disabled={!confirmedShipment || !draft || !!invalidReason}
              onClick={() => {
                if (draft) submit.mutate(draft);
              }}
            >
              발송 확인
            </ActionButton>
            {invalidReason ? (
              <Text textStyle="caption" color="fg.neutral-muted">
                {invalidReason}
              </Text>
            ) : null}
          </VStack>
        </VStack>
      )}
    </ContentLayout>
  );
}

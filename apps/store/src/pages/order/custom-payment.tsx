import { createCustomOrderMutation } from "@essesion/api-client/query";
import { useMutation } from "@tanstack/react-query";
import { Navigate, useLocation } from "react-router";

import { OrderPaymentPage } from "@/features/checkout";
import {
  type CustomOrderDraft,
  customOrderApiOptions,
  customOrderSummary,
  parseCustomOrderDraft,
} from "@/features/custom-order";
import { hasStateKey } from "@/shared/lib/guards";

export function CustomPaymentPage() {
  const location = useLocation();
  const draft = readCustomOrderDraft(location.state);
  const createOrder = useMutation(createCustomOrderMutation());

  if (!draft) return <Navigate to="/custom-order" replace />;

  const specRows = [
    ...customOrderSummary(draft.options),
    ...(draft.options.additionalNotes
      ? [{ label: "추가 요청", value: draft.options.additionalNotes }]
      : []),
    { label: "참고 이미지", value: `${draft.imageRefs.length}개` },
  ];

  return (
    <OrderPaymentPage
      breadcrumbs={[
        { label: "홈", href: "/" },
        { label: "주문 제작", href: "/custom-order" },
        { label: "맞춤 결제" },
      ]}
      title="맞춤 주문서"
      orderName={`맞춤 넥타이 ${draft.options.quantity}개`}
      original={draft.totalCost}
      paymentRowLabel="맞춤 제작"
      summaryDescription="서버에서 주문 사양과 쿠폰을 다시 확인합니다."
      specTitle="제작 사양"
      specRows={specRows}
      snapshotBase={{
        returnPath: "/order/custom-payment",
        returnState: { customOrder: draft },
        customOrder: draft,
      }}
      createOrder={async ({ addressId, couponId }) => {
        const result = await createOrder.mutateAsync({
          body: {
            shipping_address_id: addressId,
            options: customOrderApiOptions(draft.options),
            quantity: draft.options.quantity,
            reference_images: draft.imageRefs,
            additional_notes: draft.options.additionalNotes.trim(),
            user_coupon_id: couponId,
          },
        });
        return {
          paymentGroupId: result.payment_group_id,
          totalAmount: result.total_amount,
        };
      }}
    />
  );
}

function readCustomOrderDraft(state: unknown): CustomOrderDraft | null {
  if (!hasStateKey(state, "customOrder")) return null;
  return parseCustomOrderDraft(state.customOrder);
}

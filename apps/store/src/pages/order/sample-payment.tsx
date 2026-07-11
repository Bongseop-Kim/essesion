import { createSampleOrderMutation } from "@essesion/api-client/query";
import { useMutation } from "@tanstack/react-query";
import { Navigate, useLocation } from "react-router";

import { OrderPaymentPage } from "@/features/checkout";
import {
  readSampleOrderDraft,
  sampleFabricLabel,
  sampleOrderApiOptions,
  sampleTypeLabel,
} from "@/features/sample-order";

export function SamplePaymentPage() {
  const location = useLocation();
  const draft = readSampleOrderDraft(location.state);
  const createOrder = useMutation(createSampleOrderMutation());

  if (!draft) return <Navigate to="/sample-order" replace />;

  const specRows = [
    { label: "샘플 유형", value: sampleTypeLabel(draft.options.sampleType) },
    { label: "원단 구성", value: sampleFabricLabel(draft.options) },
    {
      label: "타이 방식",
      value: draft.options.tieType === "AUTO" ? "자동 타이" : "수동 타이",
    },
    {
      label: "심지",
      value: draft.options.interlining === "WOOL" ? "울 심지" : "폴리 심지",
    },
    { label: "참고 이미지", value: `${draft.imageRefs.length}개` },
  ];

  return (
    <OrderPaymentPage
      breadcrumbs={[
        { label: "홈", href: "/" },
        { label: "샘플 제작", href: "/sample-order" },
        { label: "샘플 결제" },
      ]}
      title="샘플 주문서"
      orderName="넥타이 샘플 제작"
      original={draft.totalCost}
      paymentRowLabel="샘플 제작"
      summaryDescription="서버에서 샘플 구성과 쿠폰을 다시 확인합니다."
      specTitle="샘플 사양"
      specRows={specRows}
      snapshotBase={{
        returnPath: "/order/sample-payment",
        returnState: { sampleOrder: draft },
        sampleOrder: draft,
      }}
      createOrder={async ({ addressId, couponId }) => {
        const result = await createOrder.mutateAsync({
          body: {
            shipping_address_id: addressId,
            sample_type: draft.options.sampleType,
            options: sampleOrderApiOptions(draft.options),
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

import {
  createAdminCouponMutation,
  listAdminCouponsQueryKey,
} from "@essesion/api-client/query";
import { snackbar, VStack } from "@essesion/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { RouteHeading } from "../../shared/ui/route-heading";
import {
  CouponDefinitionForm,
  couponDraftBody,
  emptyCouponDraft,
} from "./coupon-form";

export function CouponNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    ...createAdminCouponMutation(),
    onSuccess: async (coupon) => {
      snackbar("쿠폰을 등록했습니다.");
      await queryClient.invalidateQueries({
        queryKey: listAdminCouponsQueryKey(),
      });
      navigate(`/coupons/${coupon.id}`, { replace: true });
    },
  });

  return (
    <VStack gap="x6" alignItems="stretch">
      <RouteHeading
        backTo={{ to: "/coupons", label: "쿠폰 관리" }}
        title="쿠폰 등록"
      />
      <CouponDefinitionForm
        initial={emptyCouponDraft}
        resetSignal={0}
        submitLabel="쿠폰 등록"
        pending={mutation.isPending}
        error={mutation.error}
        onSubmit={(draft) => mutation.mutate({ body: couponDraftBody(draft) })}
      />
    </VStack>
  );
}

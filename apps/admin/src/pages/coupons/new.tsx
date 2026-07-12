import {
  createAdminCouponMutation,
  listAdminCouponsQueryKey,
} from "@essesion/api-client/query";
import { ActionButton, HStack, snackbar, VStack } from "@essesion/shared";
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
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title="쿠폰 등록"
          description="할인 조건과 KST 기준 만료일을 검증해 새 쿠폰을 등록합니다."
        />
        <ActionButton variant="ghost" onClick={() => navigate("/coupons")}>
          목록으로
        </ActionButton>
      </HStack>
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

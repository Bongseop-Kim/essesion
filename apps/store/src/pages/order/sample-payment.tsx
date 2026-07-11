import type { ShippingAddressOut, UserCouponOut } from "@essesion/api-client";
import {
  createSampleOrderMutation,
  listAddressesOptions,
  listMyCouponsOptions,
} from "@essesion/api-client/query";
import {
  ActionButton,
  ContentPlaceholder,
  Divider,
  Skeleton,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router";

import {
  CHECKOUT_PENDING_KEY,
  CheckoutShell,
  useCheckoutPayment,
} from "@/features/checkout";
import {
  CouponSelectModal,
  couponDiscount,
  couponLabel,
} from "@/features/coupon";
import {
  readSampleOrderDraft,
  sampleFabricLabel,
  sampleOrderApiOptions,
  sampleTypeLabel,
} from "@/features/sample-order";
import { AddressSelectModal, ShippingAddressCard } from "@/features/shipping";
import { krw } from "@/pages/shop/constants";
import { useSession } from "@/shared/store/session";
import { SummaryCard } from "@/shared/ui/summary-card";

export function SamplePaymentPage() {
  const location = useLocation();
  const user = useSession((state) => state.user);
  const draft = readSampleOrderDraft(location.state);
  const addressesQuery = useQuery(listAddressesOptions());
  const couponsQuery = useQuery(
    listMyCouponsOptions({ query: { active_only: true } }),
  );
  const createOrder = useMutation(createSampleOrderMutation());
  const [address, setAddress] = useState<ShippingAddressOut | null>(null);
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [couponModalOpen, setCouponModalOpen] = useState(false);
  const [coupon, setCoupon] = useState<UserCouponOut | null>(null);

  useEffect(() => {
    if (!address && addressesQuery.data?.[0])
      setAddress(addressesQuery.data[0]);
  }, [address, addressesQuery.data]);

  const original = draft?.totalCost ?? 0;
  const discount = couponDiscount(coupon?.coupon, original);
  const total = original - discount;
  const snapshot = draft
    ? {
        returnPath: "/order/sample-payment",
        returnState: { sampleOrder: draft },
        sampleOrder: draft,
        shippingAddressId: address?.id ?? null,
        userCouponId: coupon?.id ?? null,
      }
    : null;
  const payment = useCheckoutPayment({
    storageKey: CHECKOUT_PENDING_KEY,
    snapshot,
    orderName: "넥타이 샘플 제작",
    expectedAmount: total,
    createOrder: async () => {
      if (!draft || !address) throw new Error("shipping address is required");
      const result = await createOrder.mutateAsync({
        body: {
          shipping_address_id: address.id,
          sample_type: draft.options.sampleType,
          options: sampleOrderApiOptions(draft.options),
          reference_images: draft.imageRefs,
          additional_notes: draft.options.additionalNotes.trim(),
          user_coupon_id: coupon?.id ?? null,
        },
      });
      return {
        paymentGroupId: result.payment_group_id,
        totalAmount: result.total_amount,
      };
    },
  });

  if (!draft) return <Navigate to="/sample-order" replace />;

  const canPay = !!user && !!address && total > 0;

  return (
    <CheckoutShell
      breadcrumbs={[
        { label: "홈", href: "/" },
        { label: "샘플 제작", href: "/sample-order" },
        { label: "샘플 결제" },
      ]}
      amount={total}
      customerKey={user?.id ?? null}
      summary={
        <SummaryCard.Root>
          <SummaryCard.Section
            title="결제 금액"
            description="서버에서 샘플 구성과 쿠폰을 다시 확인합니다."
          />
          <Divider />
          <SummaryCard.Row
            label="샘플 제작"
            value={`${krw.format(original)}원`}
          />
          <SummaryCard.Row
            label="쿠폰 할인"
            value={`-${krw.format(discount)}원`}
            tone={discount > 0 ? "informative" : "neutral"}
          />
          <SummaryCard.Row label="배송비" value="0원" />
          <SummaryCard.Total
            label="결제 예정 금액"
            value={`${krw.format(total)}원`}
          />
        </SummaryCard.Root>
      }
      payDisabled={!canPay}
      payLoading={payment.isPending}
      helperText={!address ? "배송지를 먼저 등록해 주세요." : undefined}
      onPay={(widget) => void payment.pay(widget)}
    >
      <VStack gap="x6" alignItems="stretch">
        <VStack gap="x2">
          <Text as="h1" textStyle="title1">
            샘플 주문서
          </Text>
          <Text textStyle="body" color="fg.neutral-muted">
            배송지, 쿠폰, 결제 수단을 확인해 주세요.
          </Text>
        </VStack>

        {addressesQuery.isPending ? (
          <Skeleton width="100%" height={120} />
        ) : addressesQuery.isError ? (
          <ContentPlaceholder
            title="배송지를 불러오지 못했습니다"
            description="잠시 후 다시 시도해 주세요."
            action={
              <ActionButton
                type="button"
                variant="neutralOutline"
                onClick={() => void addressesQuery.refetch()}
              >
                다시 시도
              </ActionButton>
            }
          />
        ) : (
          <ShippingAddressCard
            address={address}
            onChange={() => setAddressModalOpen(true)}
          />
        )}

        <VStack gap="x3" alignItems="stretch">
          <Text as="h2" textStyle="title3">
            샘플 사양
          </Text>
          <SummaryCard.Root>
            <SummaryCard.Row
              label="샘플 유형"
              value={sampleTypeLabel(draft.options.sampleType)}
            />
            <SummaryCard.Row
              label="원단 구성"
              value={sampleFabricLabel(draft.options)}
            />
            <SummaryCard.Row
              label="타이 방식"
              value={
                draft.options.tieType === "AUTO" ? "자동 타이" : "수동 타이"
              }
            />
            <SummaryCard.Row
              label="심지"
              value={
                draft.options.interlining === "WOOL" ? "울 심지" : "폴리 심지"
              }
            />
            <SummaryCard.Row
              label="참고 이미지"
              value={`${draft.imageRefs.length}개`}
            />
          </SummaryCard.Root>
        </VStack>

        <VStack gap="x3" alignItems="stretch">
          <Text as="h2" textStyle="title3">
            쿠폰
          </Text>
          <Text textStyle="bodySm" color="fg.neutral-muted">
            {coupon
              ? `${couponLabel(coupon.coupon)} 적용`
              : "적용된 쿠폰이 없습니다."}
          </Text>
          <ActionButton
            type="button"
            variant="neutralOutline"
            onClick={() => setCouponModalOpen(true)}
          >
            쿠폰 선택
          </ActionButton>
        </VStack>
      </VStack>

      <AddressSelectModal
        open={addressModalOpen}
        selected={address}
        onOpenChange={setAddressModalOpen}
        onSelect={setAddress}
      />
      <CouponSelectModal
        coupons={couponsQuery.data ?? []}
        selected={coupon}
        loading={couponsQuery.isFetching}
        error={couponsQuery.isError}
        open={couponModalOpen}
        onOpenChange={setCouponModalOpen}
        onApply={async (next) => {
          setCoupon(next);
          setCouponModalOpen(false);
          snackbar(next ? "쿠폰을 적용했습니다." : "쿠폰 적용을 해제했습니다.");
        }}
      />
    </CheckoutShell>
  );
}

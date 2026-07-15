import type {
  CartItemOut,
  OrderItemIn,
  ReformPricingOut,
  RepairShippingIn,
  ShippingAddressOut,
  UserCouponOut,
} from "@essesion/api-client";
import { createReadUrl } from "@essesion/api-client";
import {
  createOrderMutation,
  getReformPricingOptions,
  listAddressesOptions,
  listMyCouponsOptions,
} from "@essesion/api-client/query";
import {
  ActionButton,
  Badge,
  Box,
  Callout,
  Checkbox,
  ContentPlaceholder,
  Divider,
  Grid,
  HStack,
  ImageFrame,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
  snackbar,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router";
import {
  cartItemBlockingReason,
  productUnitPrice,
  useCartActions,
  useCartItems,
} from "@/features/cart";
import {
  CHECKOUT_PENDING_KEY,
  CheckoutShell,
  readPendingCheckout,
  useCheckoutPayment,
} from "@/features/checkout";
import {
  CouponSelectModal,
  couponDiscount,
  couponLabel,
} from "@/features/coupon";
import { reformServiceLabel } from "@/features/reform";
import {
  isRepairShipmentDraft,
  RepairShipmentFields,
  shipmentDraftFromForm,
  shipmentFormFromDraft,
  shipmentInvalidReason,
} from "@/features/repair-shipping";
import {
  AddressSelectModal,
  ShippingAddressCard,
  useDaumPostcode,
} from "@/features/shipping";
import { krw } from "@/pages/shop/constants";
import { useSession } from "@/shared/store/session";
import { ContentLayout } from "@/shared/ui/content-layout";
import { SummaryCard } from "@/shared/ui/summary-card";

export function OrderFormPage() {
  const location = useLocation();
  const user = useSession((state) => state.user);
  const cart = useCartItems();
  const cartActions = useCartActions();
  const createOrder = useMutation(createOrderMutation());
  const addressesQuery = useQuery(listAddressesOptions());
  const couponsQuery = useQuery(
    listMyCouponsOptions({ query: { active_only: true } }),
  );
  const reformPricingQuery = useQuery(getReformPricingOptions());
  const pendingSnapshot = useMemo(
    () =>
      readPendingCheckout<{
        repairShipping?: RepairShippingIn | null;
        repairShipmentDraft?: unknown;
      }>(CHECKOUT_PENDING_KEY, user?.id ?? null)?.snapshot ?? null,
    [user?.id],
  );
  const pendingRepair = pendingSnapshot?.repairShipping ?? null;
  const pendingDraft = isRepairShipmentDraft(
    pendingSnapshot?.repairShipmentDraft,
  )
    ? pendingSnapshot.repairShipmentDraft
    : null;
  const postcode = useDaumPostcode();
  const [address, setAddress] = useState<ShippingAddressOut | null>(null);
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [couponItemId, setCouponItemId] = useState<string | null>(null);
  const [repairMethod, setRepairMethod] = useState<"direct" | "pickup">(
    pendingRepair?.method ?? "direct",
  );
  const [pickupSameAsShipping, setPickupSameAsShipping] = useState(
    pendingRepair?.method !== "pickup",
  );
  const [pickupName, setPickupName] = useState(
    pendingRepair?.pickup?.recipient_name ?? "",
  );
  const [pickupPhone, setPickupPhone] = useState(
    pendingRepair?.pickup?.recipient_phone ?? "",
  );
  const [pickupPostalCode, setPickupPostalCode] = useState(
    pendingRepair?.pickup?.postal_code ?? "",
  );
  const [pickupAddress, setPickupAddress] = useState(
    pendingRepair?.pickup?.address ?? "",
  );
  const [pickupDetailAddress, setPickupDetailAddress] = useState(
    pendingRepair?.pickup?.detail_address ?? "",
  );
  const [shipEnabled, setShipEnabled] = useState(!!pendingDraft);
  const [shipForm, setShipForm] = useState(() =>
    shipmentFormFromDraft(pendingDraft),
  );
  const [photosUploading, setPhotosUploading] = useState(false);

  const cartItemIds = useMemo(() => {
    const state = location.state as { cartItemIds?: unknown } | null;
    return Array.isArray(state?.cartItemIds) &&
      state.cartItemIds.every((id) => typeof id === "string")
      ? state.cartItemIds
      : [];
  }, [location.state]);

  const items = useMemo(
    () => cart.serverItems.filter((item) => cartItemIds.includes(item.item_id)),
    [cart.serverItems, cartItemIds],
  );
  const inputs = useMemo(
    () => cart.inputs.filter((item) => cartItemIds.includes(item.item_id)),
    [cart.inputs, cartItemIds],
  );
  const coupons = couponsQuery.data ?? [];
  const couponItem =
    items.find((item) => item.item_id === couponItemId) ?? null;
  const hasReformItems = items.some((item) => item.item_type === "reform");
  const repairShipping = useMemo<RepairShippingIn | null>(() => {
    if (!hasReformItems) return null;
    if (repairMethod === "direct") return { method: "direct", pickup: null };
    if (pickupSameAsShipping && address) {
      return {
        method: "pickup",
        pickup: {
          recipient_name: address.recipient_name,
          recipient_phone: address.recipient_phone,
          postal_code: address.postal_code,
          address: address.address,
          detail_address: address.address_detail,
        },
      };
    }
    return {
      method: "pickup",
      pickup: {
        recipient_name: pickupName.trim(),
        recipient_phone: pickupPhone.trim(),
        postal_code: pickupPostalCode.trim() || null,
        address: pickupAddress.trim(),
        detail_address: pickupDetailAddress.trim() || null,
      },
    };
  }, [
    address,
    hasReformItems,
    pickupAddress,
    pickupDetailAddress,
    pickupName,
    pickupPhone,
    pickupPostalCode,
    pickupSameAsShipping,
    repairMethod,
  ]);
  const totals = useMemo(
    () =>
      calculateTotals(
        items,
        hasReformItems ? reformPricingQuery.data : undefined,
        repairMethod === "pickup",
      ),
    [hasReformItems, items, reformPricingQuery.data, repairMethod],
  );
  const orderItems = useMemo<OrderItemIn[]>(
    () =>
      inputs.flatMap<OrderItemIn>((item) => {
        if (item.item_type === "product" && item.product_id != null) {
          return [
            {
              item_id: item.item_id,
              item_type: "product",
              product_id: item.product_id,
              selected_option_id: item.selected_option_id ?? null,
              quantity: item.quantity,
              reform_data: null,
              applied_user_coupon_id: item.applied_user_coupon_id ?? null,
            },
          ];
        }
        if (item.item_type === "reform" && item.reform_data) {
          return [
            {
              item_id: item.item_id,
              item_type: "reform",
              product_id: null,
              selected_option_id: null,
              quantity: 1,
              reform_data: item.reform_data,
              applied_user_coupon_id: item.applied_user_coupon_id ?? null,
            },
          ];
        }
        return [];
      }),
    [inputs],
  );
  const orderName =
    items.length <= 1
      ? (items[0]?.product?.name ?? "넥타이 수선")
      : `${items[0]?.product?.name ?? "넥타이 수선"} 외 ${items.length - 1}건`;
  const repairShipmentDraft =
    hasReformItems && repairMethod === "direct" && shipEnabled
      ? shipmentDraftFromForm(shipForm)
      : null;
  const snapshot = {
    cartItemIds,
    shippingAddressId: address?.id ?? null,
    items: orderItems,
    repairShipping,
    repairShipmentDraft,
  };
  const payment = useCheckoutPayment({
    storageKey: CHECKOUT_PENDING_KEY,
    ownerUserId: user?.id ?? null,
    snapshot,
    orderName,
    expectedAmount: totals.total,
    createOrder: async () => {
      if (!address) throw new Error("shipping address is required");
      const result = await createOrder.mutateAsync({
        body: {
          shipping_address_id: address.id,
          items: orderItems,
          repair_shipping: repairShipping,
        },
      });
      return {
        paymentGroupId: result.payment_group_id,
        totalAmount: result.total_amount,
      };
    },
  });

  useEffect(() => {
    if (!address && addressesQuery.data?.[0]) {
      setAddress(addressesQuery.data[0]);
    }
  }, [address, addressesQuery.data]);

  if (cartItemIds.length === 0) return <Navigate to="/cart" replace />;

  if (cart.isPending) {
    return (
      <ContentLayout breadcrumbs={orderCrumbs()}>
        <VStack gap="x4" alignItems="stretch">
          <Skeleton width="35%" height={32} />
          <Skeleton width="100%" height={128} />
          <Skeleton width="100%" height={180} />
        </VStack>
      </ContentLayout>
    );
  }

  if (cart.isError) {
    return (
      <ContentLayout breadcrumbs={orderCrumbs()}>
        <ContentPlaceholder
          title="주문 상품을 불러오지 못했습니다"
          description="장바구니에서 다시 시도해 주세요."
        />
      </ContentLayout>
    );
  }

  if (!user) {
    return (
      <ContentLayout breadcrumbs={orderCrumbs()}>
        <ContentPlaceholder
          title="로그인 정보를 확인하고 있습니다"
          description="잠시만 기다려 주세요."
        />
      </ContentLayout>
    );
  }

  const invalidItems =
    items.length !== cartItemIds.length ||
    items.some(
      (item) =>
        cartItemBlockingReason(item) != null ||
        (item.item_type === "product" && !item.product) ||
        (item.item_type === "reform" && !item.reform_data),
    ) ||
    orderItems.length !== cartItemIds.length;
  if (invalidItems) return <Navigate to="/cart" replace />;

  const pickupInvalid =
    hasReformItems &&
    repairMethod === "pickup" &&
    (!repairShipping?.pickup?.recipient_name.trim() ||
      !repairShipping.pickup.recipient_phone.trim() ||
      !repairShipping.pickup.address.trim());
  const shipInvalidReason =
    hasReformItems && repairMethod === "direct" && shipEnabled
      ? photosUploading
        ? "발송 사진을 업로드하는 중입니다."
        : shipmentInvalidReason(shipForm)
      : null;
  const pricingReady = !hasReformItems || !!reformPricingQuery.data;
  const canPay =
    !!address &&
    totals.total > 0 &&
    pricingReady &&
    !pickupInvalid &&
    !shipInvalidReason;

  return (
    <CheckoutShell
      breadcrumbs={orderCrumbs()}
      amount={totals.total}
      customerKey={user.id}
      summary={
        <SummaryCard.Root>
          <SummaryCard.Section
            title="결제 금액"
            description="서버에서 최종 금액을 다시 확인합니다."
          />
          <Divider />
          <SummaryCard.Row
            label="상품·수선 금액"
            value={`${krw.format(totals.subtotal)}원`}
          />
          <SummaryCard.Row
            label="쿠폰 할인"
            value={`-${krw.format(totals.discount)}원`}
            tone={totals.discount > 0 ? "informative" : "neutral"}
          />
          <SummaryCard.Row
            label="배송비"
            value={`${krw.format(totals.shipping)}원`}
          />
          {totals.pickup > 0 ? (
            <SummaryCard.Row
              label="방문 수거비"
              value={`${krw.format(totals.pickup)}원`}
            />
          ) : null}
          <SummaryCard.Total
            label="결제 예정 금액"
            value={`${krw.format(totals.total)}원`}
          />
        </SummaryCard.Root>
      }
      payDisabled={!canPay}
      payLoading={payment.isPending}
      helperText={
        !address
          ? "배송지를 먼저 등록해 주세요."
          : !pricingReady
            ? "수선 비용을 확인하는 중입니다."
            : pickupInvalid
              ? "수거지 이름, 연락처, 주소를 입력해 주세요."
              : (shipInvalidReason ?? undefined)
      }
      onPay={(widget) => void payment.pay(widget)}
    >
      <VStack gap="x6" alignItems="stretch">
        <VStack gap="x2">
          <Text as="h1" textStyle="title1">
            주문서
          </Text>
          <Text textStyle="body" color="fg.neutral-muted">
            배송지와 쿠폰, 결제 수단을 확인해 주세요.
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

        {hasReformItems ? (
          <VStack gap="x4" alignItems="stretch">
            <VStack gap="x1">
              <Text as="h2" textStyle="title3">
                수선품 보내는 방법
              </Text>
              <Text textStyle="caption" color="fg.neutral-muted">
                직접 발송하거나 기사 방문 수거를 신청할 수 있습니다.
              </Text>
            </VStack>
            {reformPricingQuery.isError ? (
              <Callout
                tone="critical"
                title="수선 배송비를 불러오지 못했습니다"
                description="잠시 후 다시 시도해 주세요."
              />
            ) : (
              <RadioGroup
                value={repairMethod}
                onValueChange={(value) =>
                  setRepairMethod(value as "direct" | "pickup")
                }
              >
                <RadioGroupItem
                  value="direct"
                  label="직접 발송할게요"
                  description="결제 후 수선품을 발송하고 발송 확인을 해주세요."
                />
                <RadioGroupItem
                  value="pickup"
                  label="방문 수거를 신청할게요"
                  description={`기사님이 방문해 수거합니다. +${krw.format(
                    reformPricingQuery.data?.pickup_fee ?? 0,
                  )}원`}
                />
              </RadioGroup>
            )}

            {repairMethod === "pickup" ? (
              <Box
                bg="bg.neutral-weak"
                borderRadius="r3"
                p={{ base: "x4", md: "x5" }}
              >
                <VStack gap="x4" alignItems="stretch">
                  <Checkbox
                    label="배송지와 같은 주소에서 수거"
                    checked={pickupSameAsShipping}
                    onChange={(event) =>
                      setPickupSameAsShipping(event.currentTarget.checked)
                    }
                  />
                  {!pickupSameAsShipping ? (
                    <Grid columns={{ base: 1, md: 2 }} gap="x3">
                      <TextField
                        label="수거지 이름"
                        required
                        value={pickupName}
                        onChange={(event) =>
                          setPickupName(event.currentTarget.value)
                        }
                      />
                      <TextField
                        label="연락처"
                        required
                        value={pickupPhone}
                        onChange={(event) =>
                          setPickupPhone(event.currentTarget.value)
                        }
                      />
                      <HStack gap="x2" align="flex-end">
                        <Box flexGrow minWidth={0}>
                          <TextField
                            label="우편번호"
                            readOnly
                            value={pickupPostalCode}
                          />
                        </Box>
                        <ActionButton
                          type="button"
                          variant="neutralOutline"
                          loading={postcode.loading}
                          onClick={() =>
                            void postcode
                              .search(({ zonecode, address: found }) => {
                                setPickupPostalCode(zonecode);
                                setPickupAddress(found);
                                setPickupDetailAddress("");
                              })
                              .catch(() =>
                                snackbar("주소 검색을 불러오지 못했습니다."),
                              )
                          }
                        >
                          주소 검색
                        </ActionButton>
                      </HStack>
                      <TextField
                        label="주소"
                        required
                        readOnly
                        value={pickupAddress}
                      />
                      <TextField
                        label="상세 주소"
                        value={pickupDetailAddress}
                        onChange={(event) =>
                          setPickupDetailAddress(event.currentTarget.value)
                        }
                      />
                    </Grid>
                  ) : null}
                </VStack>
              </Box>
            ) : (
              <Box
                bg="bg.neutral-weak"
                borderRadius="r3"
                p={{ base: "x4", md: "x5" }}
              >
                <VStack gap="x4" alignItems="stretch">
                  <Checkbox
                    label="이미 발송했어요"
                    checked={shipEnabled}
                    onChange={(event) =>
                      setShipEnabled(event.currentTarget.checked)
                    }
                  />
                  {shipEnabled ? (
                    <RepairShipmentFields
                      state={shipForm}
                      onChange={setShipForm}
                      onUploadingChange={setPhotosUploading}
                    />
                  ) : null}
                </VStack>
              </Box>
            )}
          </VStack>
        ) : null}

        <VStack gap="x3" alignItems="stretch">
          <Text as="h2" textStyle="title3">
            주문 상품 {items.length}개
          </Text>
          {items.map((item) => (
            <OrderItemCard
              key={item.item_id}
              item={item}
              onCouponChange={() => setCouponItemId(item.item_id)}
            />
          ))}
        </VStack>
      </VStack>

      <AddressSelectModal
        open={addressModalOpen}
        selected={address}
        onOpenChange={setAddressModalOpen}
        onSelect={setAddress}
      />
      <CouponSelectModal
        coupons={coupons}
        selected={couponItem?.applied_coupon ?? null}
        loading={couponsQuery.isFetching}
        error={couponsQuery.isError}
        open={couponItem != null}
        onOpenChange={(open) => {
          if (!open) setCouponItemId(null);
        }}
        onApply={async (coupon: UserCouponOut | null) => {
          if (!couponItem) return;
          try {
            await cartActions.applyCoupon(couponItem.item_id, coupon);
            setCouponItemId(null);
            snackbar(
              coupon ? "쿠폰을 적용했습니다." : "쿠폰 적용을 해제했습니다.",
            );
          } catch {
            snackbar("쿠폰을 변경하지 못했습니다.");
          }
        }}
      />
    </CheckoutShell>
  );
}

function OrderItemCard({
  item,
  onCouponChange,
}: {
  item: CartItemOut;
  onCouponChange: () => void;
}) {
  const product = item.product;
  const reformData = item.reform_data;
  const reformImageQuery = useQuery({
    queryKey: ["reform-image", reformData?.tie.image.object_key],
    enabled: item.item_type === "reform" && !!reformData,
    queryFn: async () => {
      if (!reformData) throw new Error("수선 이미지 정보가 없습니다.");
      const response = await createReadUrl({
        body: { object_key: reformData.tie.image.object_key },
      });
      if (!response.data) throw new Error("수선 이미지를 불러오지 못했습니다.");
      return response.data.read_url;
    },
    staleTime: 10 * 60 * 1000,
  });
  const unitPrice = product
    ? productUnitPrice(product, item.selected_option)
    : (reformData?.cost ?? 0);
  const linePrice = unitPrice * item.quantity;
  const discount = couponDiscount(item.applied_coupon?.coupon, linePrice);

  return (
    <Box
      bg="bg.layer-default"
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="r3"
      p={{ base: "x4", md: "x5" }}
    >
      <Grid templateColumns="5rem minmax(0, 1fr)" gap="x4">
        <ImageFrame
          ratio={1}
          src={product?.image ?? reformImageQuery.data}
          alt={product?.name ?? "수선 넥타이"}
          borderRadius="r2"
          fit="cover"
          stroke
        />
        <VStack gap="x2" alignItems="stretch">
          <HStack justify="space-between" gap="x3" align="flex-start">
            <VStack gap="x1" minWidth={0}>
              <Box alignSelf="flex-start">
                <Badge variant="outline" className="justify-center">
                  {item.item_type === "reform" ? "수선" : "상품"}
                </Badge>
              </Box>
              <Text textStyle="label" maxLines={2}>
                {product?.name ?? "넥타이 수선"}
              </Text>
              <Text textStyle="caption" color="fg.neutral-muted">
                {reformData
                  ? reformServiceLabel(reformData)
                  : `${item.selected_option?.name ?? "FREE"} / ${item.quantity}개`}
              </Text>
            </VStack>
            <OrderItemPrice linePrice={linePrice} discount={discount} />
          </HStack>
          <HStack justify="space-between" gap="x3">
            <Text textStyle="caption" color="fg.neutral-muted">
              {item.applied_coupon
                ? `${couponLabel(item.applied_coupon.coupon)} 적용`
                : "적용된 쿠폰 없음"}
            </Text>
            <ActionButton
              type="button"
              variant="ghost"
              size="small"
              onClick={onCouponChange}
            >
              쿠폰 변경
            </ActionButton>
          </HStack>
        </VStack>
      </Grid>
    </Box>
  );
}

function calculateTotals(
  items: CartItemOut[],
  reformPricing?: ReformPricingOut,
  pickup = false,
) {
  const lines = items.reduce(
    (totals, item) => {
      const unitPrice = item.product
        ? productUnitPrice(item.product, item.selected_option)
        : (item.reform_data?.cost ?? 0);
      const subtotal = unitPrice * item.quantity;
      const discount = couponDiscount(item.applied_coupon?.coupon, subtotal);
      return {
        subtotal: totals.subtotal + subtotal,
        discount: totals.discount + discount,
        total: totals.total + subtotal - discount,
      };
    },
    { subtotal: 0, discount: 0, total: 0 },
  );
  const hasReform = items.some((item) => item.item_type === "reform");
  const shipping = hasReform ? (reformPricing?.shipping_cost ?? 0) : 0;
  const pickupFee = hasReform && pickup ? (reformPricing?.pickup_fee ?? 0) : 0;
  return {
    ...lines,
    shipping,
    pickup: pickupFee,
    total: lines.total + shipping + pickupFee,
  };
}

function OrderItemPrice({
  linePrice,
  discount,
}: {
  linePrice: number;
  discount: number;
}) {
  if (discount <= 0) {
    return <Text textStyle="label">{krw.format(linePrice)}원</Text>;
  }
  return (
    <VStack gap="x0_5" alignItems="flex-end">
      <Text
        textStyle="caption"
        color="fg.neutral-muted"
        style={{ textDecoration: "line-through" }}
      >
        {krw.format(linePrice)}원
      </Text>
      <Text textStyle="label" color="fg.critical">
        {krw.format(linePrice - discount)}원
      </Text>
    </VStack>
  );
}

function orderCrumbs() {
  return [
    { label: "홈", href: "/" },
    { label: "장바구니", href: "/cart" },
    { label: "주문서" },
  ];
}

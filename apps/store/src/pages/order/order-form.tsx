import type {
  CartItemOut,
  OrderItemIn,
  ShippingAddressOut,
  UserCouponOut,
} from "@essesion/api-client";
import {
  createOrderMutation,
  listAddressesOptions,
  listMyCouponsOptions,
} from "@essesion/api-client/query";
import {
  ActionButton,
  Badge,
  Box,
  ContentPlaceholder,
  Divider,
  Grid,
  HStack,
  ImageFrame,
  Skeleton,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router";
import {
  productUnitPrice,
  useCartActions,
  useCartItems,
} from "@/features/cart";
import {
  CHECKOUT_PENDING_KEY,
  PaymentWidget,
  type PaymentWidgetHandle,
  useCheckoutPayment,
} from "@/features/checkout";
import {
  CouponSelectModal,
  couponDiscount,
  couponLabel,
} from "@/features/coupon";
import { AddressSelectModal, ShippingAddressCard } from "@/features/shipping";
import { krw } from "@/pages/shop/constants";
import { useSession } from "@/shared/store/session";
import { ContentLayout } from "@/shared/ui/content-layout";
import { PaymentActionBar } from "@/shared/ui/payment-action-bar";
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
  const [address, setAddress] = useState<ShippingAddressOut | null>(null);
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [couponItemId, setCouponItemId] = useState<string | null>(null);
  const [widgetReady, setWidgetReady] = useState(false);
  const paymentWidgetRef = useRef<PaymentWidgetHandle | null>(null);

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
  const totals = useMemo(() => calculateTotals(items), [items]);
  const orderItems = useMemo<OrderItemIn[]>(
    () =>
      inputs.flatMap((item) =>
        item.item_type === "product" && item.product_id != null
          ? [
              {
                item_id: item.item_id,
                item_type: "product",
                product_id: item.product_id,
                selected_option_id: item.selected_option_id ?? null,
                quantity: item.quantity,
                reform_data: null,
                applied_user_coupon_id: item.applied_user_coupon_id ?? null,
              },
            ]
          : [],
      ),
    [inputs],
  );
  const orderName =
    items.length <= 1
      ? (items[0]?.product?.name ?? "상품")
      : `${items[0]?.product?.name ?? "상품"} 외 ${items.length - 1}건`;
  const snapshot = {
    cartItemIds,
    shippingAddressId: address?.id ?? null,
    items: orderItems,
  };
  const payment = useCheckoutPayment({
    storageKey: CHECKOUT_PENDING_KEY,
    snapshot,
    orderName,
    expectedAmount: totals.total,
    createOrder: async () => {
      if (!address) throw new Error("shipping address is required");
      const result = await createOrder.mutateAsync({
        body: { shipping_address_id: address.id, items: orderItems },
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

  if (!user) return <Navigate to="/login" replace />;

  const invalidItems =
    items.length !== cartItemIds.length ||
    items.some((item) => item.item_type !== "product" || !item.product) ||
    orderItems.length !== cartItemIds.length;
  if (invalidItems) return <Navigate to="/cart" replace />;

  const canPay = !!address && widgetReady && totals.total > 0;

  return (
    <ContentLayout
      breadcrumbs={orderCrumbs()}
      sidebar={
        <VStack gap="x6" alignItems="stretch">
          <SummaryCard.Root>
            <SummaryCard.Section
              title="결제 금액"
              description="서버에서 최종 금액을 다시 확인합니다."
            />
            <Divider />
            <SummaryCard.Row
              label="상품 금액"
              value={`${krw.format(totals.subtotal)}원`}
            />
            <SummaryCard.Row
              label="쿠폰 할인"
              value={`-${krw.format(totals.discount)}원`}
              tone={totals.discount > 0 ? "informative" : "neutral"}
            />
            <SummaryCard.Row label="배송비" value="0원" />
            <SummaryCard.Total
              label="결제 예정 금액"
              value={`${krw.format(totals.total)}원`}
            />
          </SummaryCard.Root>
          <PaymentWidget
            ref={paymentWidgetRef}
            amount={totals.total}
            customerKey={user.id}
            onReadyChange={setWidgetReady}
          />
        </VStack>
      }
      actionBar={
        <PaymentActionBar
          amount={totals.total}
          disabled={!canPay}
          loading={payment.isPending}
          helperText={!address ? "배송지를 먼저 등록해 주세요." : undefined}
          onClick={() => void payment.pay(paymentWidgetRef.current)}
        />
      }
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
    </ContentLayout>
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
  if (!product) return null;
  const unitPrice = productUnitPrice(product, item.selected_option);
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
          src={product.image}
          alt={product.name}
          borderRadius="r2"
          fit="cover"
          stroke
        />
        <VStack gap="x2" alignItems="stretch">
          <HStack justify="space-between" gap="x3" align="flex-start">
            <VStack gap="x1" minWidth={0}>
              <Box alignSelf="flex-start">
                <Badge variant="outline" className="justify-center">
                  상품
                </Badge>
              </Box>
              <Text textStyle="label" maxLines={2}>
                {product.name}
              </Text>
              <Text textStyle="caption" color="fg.neutral-muted">
                {item.selected_option?.name ?? "FREE"} / {item.quantity}개
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

function calculateTotals(items: CartItemOut[]) {
  return items.reduce(
    (totals, item) => {
      if (!item.product) return totals;
      const unitPrice = productUnitPrice(item.product, item.selected_option);
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

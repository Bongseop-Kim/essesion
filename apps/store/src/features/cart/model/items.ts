import type {
  CartItemIn,
  CartItemOut,
  CouponOut,
  ProductOptionOut,
  ProductOut,
  UserCouponOut,
} from "@essesion/api-client";

export const cartItemId = (productId: number, optionId?: string | null) =>
  `product:${productId}:${optionId ?? "base"}`;

export function cartItemToInput(item: CartItemOut): CartItemIn | null {
  if (item.item_type === "product" && item.product) {
    return {
      item_id: item.item_id,
      item_type: "product",
      product_id: item.product.id,
      selected_option_id: item.selected_option?.id ?? null,
      quantity: item.quantity,
      reform_data: null,
      applied_user_coupon_id: item.applied_coupon?.id ?? null,
    };
  }
  if (item.item_type === "reform") {
    return {
      item_id: item.item_id,
      item_type: "reform",
      quantity: item.quantity,
      reform_data: item.reform_data ?? {},
      applied_user_coupon_id: item.applied_coupon?.id ?? null,
    };
  }
  return null;
}

export function cartItemsToInputs(items: CartItemOut[]): CartItemIn[] {
  return items.flatMap((item) => {
    const input = cartItemToInput(item);
    return input ? [input] : [];
  });
}

export function addProductToCartItems({
  items,
  product,
  option,
  quantity,
}: {
  items: CartItemIn[];
  product: ProductOut;
  option?: ProductOptionOut | null;
  quantity: number;
}): CartItemIn[] {
  const item_id = cartItemId(product.id, option?.id);
  const incoming: CartItemIn = {
    item_id,
    item_type: "product",
    product_id: product.id,
    selected_option_id: option?.id ?? null,
    quantity,
    reform_data: null,
  };
  const existing = items.findIndex((item) => item.item_id === item_id);
  if (existing < 0) return [...items, incoming];
  return items.map((item, index) =>
    index === existing ? { ...item, quantity: item.quantity + quantity } : item,
  );
}

export function updateCartItemQuantity(
  items: CartItemIn[],
  itemId: string,
  quantity: number,
): CartItemIn[] {
  if (quantity < 1) return items;
  return items.map((item) =>
    item.item_id === itemId ? { ...item, quantity } : item,
  );
}

export function removeCartItemIds(
  items: CartItemIn[],
  itemIds: readonly string[],
): CartItemIn[] {
  const removeIds = new Set(itemIds);
  return items.filter((item) => !removeIds.has(item.item_id));
}

export function applyCartItemCoupon(
  items: CartItemIn[],
  itemId: string,
  coupon: UserCouponOut | null,
): CartItemIn[] {
  return items.map((item) =>
    item.item_id === itemId
      ? { ...item, applied_user_coupon_id: coupon?.id ?? null }
      : item,
  );
}

export function updateProductCartItemOption({
  items,
  itemId,
  product,
  option,
  quantity,
}: {
  items: CartItemIn[];
  itemId: string;
  product: ProductOut;
  option?: ProductOptionOut | null;
  quantity: number;
}): CartItemIn[] {
  const nextItemId = cartItemId(product.id, option?.id);
  const currentItem = items.find((item) => item.item_id === itemId);
  const withoutCurrent = items.filter((item) => item.item_id !== itemId);
  const existing = withoutCurrent.findIndex(
    (item) => item.item_id === nextItemId,
  );
  if (existing >= 0) {
    return withoutCurrent.map((item, index) =>
      index === existing
        ? {
            ...item,
            quantity: item.quantity + quantity,
            applied_user_coupon_id:
              item.applied_user_coupon_id ??
              currentItem?.applied_user_coupon_id ??
              null,
          }
        : item,
    );
  }
  return [
    ...withoutCurrent,
    {
      item_id: nextItemId,
      item_type: "product",
      product_id: product.id,
      selected_option_id: option?.id ?? null,
      quantity,
      reform_data: null,
      applied_user_coupon_id: currentItem?.applied_user_coupon_id ?? null,
    },
  ];
}

export function selectedOption(
  product: ProductOut | null | undefined,
  optionId?: string | null,
) {
  if (!product || !optionId) return null;
  return product.options?.find((option) => option.id === optionId) ?? null;
}

export function productUnitPrice(
  product: ProductOut,
  option?: ProductOptionOut | null,
) {
  return product.price + (option?.additional_price ?? 0);
}

export function couponLabel(coupon?: CouponOut | null) {
  if (!coupon) return "쿠폰";
  return coupon.display_name ?? coupon.name;
}

export function couponDiscount(
  coupon: CouponOut | null | undefined,
  amount: number,
) {
  if (!coupon) return 0;
  const value = Number(coupon.discount_value);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const raw =
    coupon.discount_type === "percent" || coupon.discount_type === "percentage"
      ? Math.floor((amount * value) / 100)
      : value;
  const max = coupon.max_discount_amount
    ? Number(coupon.max_discount_amount)
    : null;
  const capped = max && Number.isFinite(max) ? Math.min(raw, max) : raw;
  return Math.min(amount, Math.max(0, capped));
}

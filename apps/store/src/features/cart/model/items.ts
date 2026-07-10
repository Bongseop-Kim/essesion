import type {
  CartItemIn,
  CartItemOut,
  ProductOptionOut,
  ProductOut,
  ReformDataIn,
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
  if (item.item_type === "reform" && item.reform_data) {
    return {
      item_id: item.item_id,
      item_type: "reform",
      quantity: item.quantity,
      reform_data: { tie: item.reform_data.tie },
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

export function upsertReformCartItems(
  items: CartItemIn[],
  reforms: Array<{ itemId: string; reformData: ReformDataIn }>,
): CartItemIn[] {
  const incoming = new Map(reforms.map((reform) => [reform.itemId, reform]));
  const next = items.map((item) => {
    const reform = incoming.get(item.item_id);
    if (!reform) return item;
    incoming.delete(item.item_id);
    return {
      item_id: reform.itemId,
      item_type: "reform" as const,
      quantity: 1,
      product_id: null,
      selected_option_id: null,
      reform_data: reform.reformData,
      applied_user_coupon_id: item.applied_user_coupon_id ?? null,
    };
  });
  return [
    ...next,
    ...Array.from(incoming.values(), (reform) => ({
      item_id: reform.itemId,
      item_type: "reform" as const,
      quantity: 1,
      product_id: null,
      selected_option_id: null,
      reform_data: reform.reformData,
      applied_user_coupon_id: null,
    })),
  ];
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

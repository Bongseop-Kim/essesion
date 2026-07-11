import type {
  CartItemIn,
  ProductOptionOut,
  ProductOut,
  ReformDataIn,
  UserCouponOut,
} from "@essesion/api-client";
import { describe, expect, it } from "vitest";

import {
  addProductToCartItems,
  applyCartItemCoupon,
  productUnitPrice,
  removeCartItemIds,
  updateCartItemQuantity,
  updateProductCartItemOption,
  upsertReformCartItems,
} from "./items";

const product = (values: Partial<ProductOut> = {}): ProductOut =>
  ({
    id: 1,
    price: 10_000,
    options: [],
    ...values,
  }) as ProductOut;

const option = (values: Partial<ProductOptionOut> = {}): ProductOptionOut =>
  ({
    id: "opt-1",
    additional_price: 2_000,
    ...values,
  }) as ProductOptionOut;

const item = (values: Partial<CartItemIn> = {}): CartItemIn => ({
  item_id: "product:1:base",
  item_type: "product",
  product_id: 1,
  selected_option_id: null,
  quantity: 1,
  reform_data: null,
  ...values,
});

const userCoupon = (id: string): UserCouponOut => ({ id }) as UserCouponOut;

const reformData = {} as ReformDataIn;

describe("productUnitPrice", () => {
  it("adds the option surcharge to the base price", () => {
    expect(productUnitPrice(product())).toBe(10_000);
    expect(productUnitPrice(product(), option())).toBe(12_000);
    expect(
      productUnitPrice(product(), option({ additional_price: null })),
    ).toBe(10_000);
  });
});

describe("addProductToCartItems", () => {
  it("appends a new line for a new product/option key", () => {
    const next = addProductToCartItems({
      items: [item()],
      product: product({ id: 2 }),
      option: option(),
      quantity: 3,
    });
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({
      item_id: "product:2:opt-1",
      selected_option_id: "opt-1",
      quantity: 3,
    });
  });

  it("merges quantity into an existing line with the same key", () => {
    const next = addProductToCartItems({
      items: [item({ quantity: 2 })],
      product: product(),
      quantity: 3,
    });
    expect(next).toHaveLength(1);
    expect(next[0].quantity).toBe(5);
  });
});

describe("upsertReformCartItems", () => {
  it("replaces an existing reform line and keeps its coupon", () => {
    const next = upsertReformCartItems(
      [
        item({
          item_id: "reform:1",
          item_type: "reform",
          applied_user_coupon_id: "uc-1",
        }),
      ],
      [{ itemId: "reform:1", reformData }],
    );
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      item_type: "reform",
      quantity: 1,
      applied_user_coupon_id: "uc-1",
    });
  });

  it("appends new reform lines without a coupon", () => {
    const next = upsertReformCartItems(
      [item()],
      [{ itemId: "reform:1", reformData }],
    );
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({
      item_id: "reform:1",
      applied_user_coupon_id: null,
    });
  });
});

describe("updateCartItemQuantity", () => {
  it("updates only the targeted line", () => {
    const next = updateCartItemQuantity(
      [item(), item({ item_id: "product:2:base" })],
      "product:2:base",
      4,
    );
    expect(next[0].quantity).toBe(1);
    expect(next[1].quantity).toBe(4);
  });

  it("returns the original list for quantity below 1", () => {
    const items = [item()];
    expect(updateCartItemQuantity(items, "product:1:base", 0)).toBe(items);
  });
});

describe("applyCartItemCoupon", () => {
  it("sets and clears the coupon on the targeted line only", () => {
    const items = [item(), item({ item_id: "product:2:base" })];
    const applied = applyCartItemCoupon(
      items,
      "product:1:base",
      userCoupon("uc-1"),
    );
    expect(applied[0].applied_user_coupon_id).toBe("uc-1");
    expect(applied[1].applied_user_coupon_id).toBeUndefined();

    const cleared = applyCartItemCoupon(applied, "product:1:base", null);
    expect(cleared[0].applied_user_coupon_id).toBeNull();
  });
});

describe("removeCartItemIds", () => {
  it("removes every listed id", () => {
    const next = removeCartItemIds(
      [item(), item({ item_id: "a" }), item({ item_id: "b" })],
      ["product:1:base", "b"],
    );
    expect(next.map((entry) => entry.item_id)).toEqual(["a"]);
  });
});

describe("updateProductCartItemOption", () => {
  it("moves the line to the new option key and carries the coupon", () => {
    const next = updateProductCartItemOption({
      items: [item({ applied_user_coupon_id: "uc-1" })],
      itemId: "product:1:base",
      product: product(),
      option: option(),
      quantity: 2,
    });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      item_id: "product:1:opt-1",
      selected_option_id: "opt-1",
      quantity: 2,
      applied_user_coupon_id: "uc-1",
    });
  });

  it("merges into an existing target line, preferring its coupon", () => {
    const next = updateProductCartItemOption({
      items: [
        item({ applied_user_coupon_id: "uc-current" }),
        item({
          item_id: "product:1:opt-1",
          selected_option_id: "opt-1",
          quantity: 2,
          applied_user_coupon_id: "uc-existing",
        }),
      ],
      itemId: "product:1:base",
      product: product(),
      option: option(),
      quantity: 3,
    });
    expect(next).toHaveLength(1);
    expect(next[0].quantity).toBe(5);
    expect(next[0].applied_user_coupon_id).toBe("uc-existing");
  });

  it("falls back to the current line's coupon when the target has none", () => {
    const next = updateProductCartItemOption({
      items: [
        item({ applied_user_coupon_id: "uc-current" }),
        item({
          item_id: "product:1:opt-1",
          selected_option_id: "opt-1",
          applied_user_coupon_id: null,
        }),
      ],
      itemId: "product:1:base",
      product: product(),
      option: option(),
      quantity: 1,
    });
    expect(next[0].applied_user_coupon_id).toBe("uc-current");
  });
});

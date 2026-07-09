import type {
  CartItemIn,
  CartItemOut,
  ProductOptionOut,
  ProductOut,
  UserCouponOut,
} from "@essesion/api-client";
import {
  getCartOptions,
  getCartQueryKey,
  replaceCartMutation,
} from "@essesion/api-client/query";
import { snackbar } from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useSession } from "@/shared/store/session";
import {
  addProductToCartItems,
  applyCartItemCoupon,
  cartItemId,
  cartItemsToInputs,
  removeCartItemIds,
  updateCartItemQuantity,
  updateProductCartItemOption,
} from "./items";
import {
  clearGuestCartItems,
  getGuestCartItems,
  guestCartQueryKey,
  setGuestCartItems,
} from "./storage";

export function useCartAuthSync() {
  const status = useSession((state) => state.status);
  const userId = useSession((state) => state.user?.id ?? null);
  const queryClient = useQueryClient();
  const replaceCart = useMutation(replaceCartMutation());
  const previousUserId = useRef<string | null>(null);
  const processing = useRef(false);

  useEffect(() => {
    if (status === "loading") return;
    if (status === "authenticated" && !userId) return;
    const nextUserId = status === "authenticated" ? userId : null;
    if (nextUserId === previousUserId.current || processing.current) return;

    let cancelled = false;
    processing.current = true;
    (async () => {
      try {
        if (!nextUserId) {
          const guestItems = await getGuestCartItems();
          if (!cancelled) {
            queryClient.setQueryData(guestCartQueryKey, guestItems);
            previousUserId.current = null;
          }
          return;
        }

        const serverItems = await queryClient.fetchQuery(getCartOptions());
        const guestItems = await getGuestCartItems();
        if (guestItems.length === 0) {
          queryClient.setQueryData(getCartQueryKey(), serverItems);
          previousUserId.current = nextUserId;
          return;
        }

        try {
          const nextCart = await replaceCart.mutateAsync({
            body: { items: guestItems },
          });
          await clearGuestCartItems();
          if (!cancelled) {
            queryClient.setQueryData(getCartQueryKey(), nextCart);
            queryClient.setQueryData(guestCartQueryKey, []);
            snackbar("장바구니를 계정에 동기화했습니다.");
          }
        } catch {
          await clearGuestCartItems();
          if (!cancelled) {
            queryClient.setQueryData(getCartQueryKey(), serverItems);
            queryClient.setQueryData(guestCartQueryKey, []);
            snackbar(
              "장바구니를 동기화하지 못해 기존 장바구니를 불러왔습니다.",
            );
          }
        }
        previousUserId.current = nextUserId;
      } catch {
        if (!cancelled) {
          snackbar("장바구니를 불러오지 못했습니다.");
        }
      } finally {
        processing.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [queryClient, replaceCart, status, userId]);
}

export function useCartItems() {
  const status = useSession((state) => state.status);
  const serverQuery = useQuery({
    ...getCartOptions(),
    enabled: status === "authenticated",
  });
  const guestQuery = useQuery({
    queryKey: guestCartQueryKey,
    queryFn: getGuestCartItems,
    enabled: status === "anonymous",
  });

  if (status === "authenticated") {
    const serverItems = serverQuery.data ?? [];
    return {
      status,
      inputs: cartItemsToInputs(serverItems),
      serverItems,
      isPending: serverQuery.isPending,
      isFetching: serverQuery.isFetching,
      isError: serverQuery.isError,
      refetch: serverQuery.refetch,
    };
  }

  return {
    status,
    inputs: guestQuery.data ?? [],
    serverItems: [] as CartItemOut[],
    isPending: status === "loading" || guestQuery.isPending,
    isFetching: guestQuery.isFetching,
    isError: guestQuery.isError,
    refetch: guestQuery.refetch,
  };
}

export function useCartActions() {
  const status = useSession((state) => state.status);
  const queryClient = useQueryClient();
  const replaceCart = useMutation(replaceCartMutation());

  const readInputs = async () => {
    if (status === "authenticated") {
      const items = await queryClient.fetchQuery(getCartOptions());
      return cartItemsToInputs(items);
    }
    return getGuestCartItems();
  };

  const persistInputs = async (nextItems: CartItemIn[]) => {
    if (status === "authenticated") {
      const nextCart = await replaceCart.mutateAsync({
        body: { items: nextItems },
      });
      queryClient.setQueryData(getCartQueryKey(), nextCart);
      return;
    }
    await setGuestCartItems(nextItems);
    queryClient.setQueryData(guestCartQueryKey, nextItems);
  };

  const updateInputs = async (
    updater: (items: CartItemIn[]) => CartItemIn[],
  ) => {
    const previous = await readInputs();
    const next = updater(previous);
    if (next === previous) return;
    try {
      await persistInputs(next);
    } catch (error) {
      if (status === "anonymous") {
        await setGuestCartItems(previous);
        queryClient.setQueryData(guestCartQueryKey, previous);
      }
      throw error;
    }
  };

  return {
    isPending: replaceCart.isPending,
    async addProduct({
      product,
      option,
      quantity,
    }: {
      product: ProductOut;
      option?: ProductOptionOut | null;
      quantity: number;
    }) {
      await updateInputs((items) =>
        addProductToCartItems({ items, product, option, quantity }),
      );
    },
    async updateQuantity(itemId: string, quantity: number) {
      await updateInputs((items) =>
        updateCartItemQuantity(items, itemId, quantity),
      );
    },
    async updateProductOption({
      itemId,
      product,
      option,
      quantity,
    }: {
      itemId: string;
      product: ProductOut;
      option?: ProductOptionOut | null;
      quantity: number;
    }) {
      await updateInputs((items) =>
        updateProductCartItemOption({
          items,
          itemId,
          product,
          option,
          quantity,
        }),
      );
    },
    async removeItems(itemIds: readonly string[]) {
      await updateInputs((items) => removeCartItemIds(items, itemIds));
    },
    async applyCoupon(itemId: string, coupon: UserCouponOut | null) {
      await updateInputs((items) => applyCartItemCoupon(items, itemId, coupon));
    },
    async currentQuantity(productId: number, optionId?: string | null) {
      const itemId = cartItemId(productId, optionId);
      const items = await readInputs();
      return items.find((item) => item.item_id === itemId)?.quantity ?? 0;
    },
  };
}

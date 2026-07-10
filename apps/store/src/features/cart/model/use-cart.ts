import {
  type CartItemIn,
  type CartItemOut,
  type ProductOptionOut,
  type ProductOut,
  replaceCart as replaceCartRequest,
  type UserCouponOut,
} from "@essesion/api-client";
import {
  getCartOptions,
  getCartQueryKey,
  replaceCartMutation,
} from "@essesion/api-client/query";
import { snackbar } from "@essesion/shared";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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
  upsertReformCartItems,
} from "./items";
import {
  clearGuestCartItems,
  getGuestCartItems,
  guestCartQueryKey,
  setGuestCartItems,
} from "./storage";

let activeGuestSync: Promise<void> | null = null;

export function syncGuestCartToAccount(queryClient: QueryClient) {
  activeGuestSync ??= (async () => {
    const serverItems = await queryClient.fetchQuery(getCartOptions());
    const guestItems = await getGuestCartItems();
    if (guestItems.length === 0) {
      queryClient.setQueryData(getCartQueryKey(), serverItems);
      return;
    }

    const response = await replaceCartRequest({ body: { items: guestItems } });
    if (!response.data) {
      queryClient.setQueryData(getCartQueryKey(), serverItems);
      snackbar("장바구니를 동기화하지 못해 기존 장바구니를 불러왔습니다.");
      throw new Error("guest cart sync failed");
    }
    await clearGuestCartItems();
    queryClient.setQueryData(getCartQueryKey(), response.data);
    queryClient.setQueryData(guestCartQueryKey, []);
    snackbar("장바구니를 계정에 동기화했습니다.");
  })().finally(() => {
    activeGuestSync = null;
  });
  return activeGuestSync;
}

export function useCartAuthSync() {
  const status = useSession((state) => state.status);
  const userId = useSession((state) => state.user?.id ?? null);
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    if (status === "authenticated" && !userId) return;
    const nextUserId = status === "authenticated" ? userId : null;
    if (nextUserId === previousUserId.current) return;

    let cancelled = false;
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

        await syncGuestCartToAccount(queryClient);
        if (!cancelled) previousUserId.current = nextUserId;
      } catch {
        if (!cancelled) {
          snackbar("장바구니를 불러오지 못했습니다.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [queryClient, status, userId]);
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
    async upsertReforms(
      reforms: Array<{
        itemId: string;
        reformData: NonNullable<CartItemIn["reform_data"]>;
      }>,
    ) {
      await updateInputs((items) => upsertReformCartItems(items, reforms));
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

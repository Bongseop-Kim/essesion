import {
  type CartItemIn,
  type CartItemOut,
  getCart as getCartRequest,
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
import { getStoreTokenSnapshot } from "@/shared/lib/api-client";
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
import { createCartUpdateQueue } from "./update-queue";

const cartUpdateQueue = createCartUpdateQueue();
const activeGuestSyncs = new Map<string, Promise<boolean>>();

type CartSession =
  | { status: "anonymous"; tokenRevision: number }
  | {
      status: "authenticated";
      userId: string;
      accessToken: string;
      tokenRevision: number;
    };

function captureCartSession(): CartSession | null {
  const session = useSession.getState();
  const token = getStoreTokenSnapshot();
  if (session.status === "anonymous" && token.accessToken === null) {
    return { status: "anonymous", tokenRevision: token.revision };
  }
  if (
    session.status === "authenticated" &&
    session.user?.id &&
    token.accessToken &&
    session.accessToken === token.accessToken
  ) {
    return {
      status: "authenticated",
      userId: session.user.id,
      accessToken: token.accessToken,
      tokenRevision: token.revision,
    };
  }
  return null;
}

function isCurrentCartSession(expected: CartSession) {
  const current = captureCartSession();
  if (!current || current.status !== expected.status) return false;
  if (current.tokenRevision !== expected.tokenRevision) return false;
  return (
    current.status === "anonymous" ||
    (expected.status === "authenticated" &&
      current.userId === expected.userId &&
      current.accessToken === expected.accessToken)
  );
}

function cartAuthorization(
  session: Extract<CartSession, { status: "authenticated" }>,
) {
  return { Authorization: `Bearer ${session.accessToken}` };
}

export function syncGuestCartToAccount(queryClient: QueryClient) {
  const session = captureCartSession();
  if (session?.status !== "authenticated") {
    return Promise.resolve(false);
  }
  const key = `${session.userId}:${session.tokenRevision}`;
  const active = activeGuestSyncs.get(key);
  if (active) return active;

  const syncing = cartUpdateQueue.enqueue(async () => {
    if (!isCurrentCartSession(session)) return false;
    const { data: serverItems } = await getCartRequest({
      headers: cartAuthorization(session),
      throwOnError: true,
    });
    if (!isCurrentCartSession(session)) return false;
    const guestItems = await getGuestCartItems();
    if (!isCurrentCartSession(session)) return false;
    if (guestItems.length === 0) {
      queryClient.setQueryData(getCartQueryKey(), serverItems);
      return true;
    }

    const response = await replaceCartRequest({
      body: { items: guestItems },
      headers: cartAuthorization(session),
    });
    if (!response.data) {
      if (isCurrentCartSession(session)) {
        queryClient.setQueryData(getCartQueryKey(), serverItems);
        snackbar("장바구니를 동기화하지 못해 기존 장바구니를 불러왔습니다.");
      }
      throw new Error("guest cart sync failed");
    }
    if (!isCurrentCartSession(session)) return false;
    await clearGuestCartItems();
    if (!isCurrentCartSession(session)) return false;
    queryClient.setQueryData(getCartQueryKey(), response.data);
    queryClient.setQueryData(guestCartQueryKey, []);
    snackbar("장바구니를 계정에 동기화했습니다.");
    return true;
  });
  activeGuestSyncs.set(key, syncing);
  const cleanup = () => {
    if (activeGuestSyncs.get(key) === syncing) activeGuestSyncs.delete(key);
  };
  void syncing.then(cleanup, cleanup);
  return syncing;
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

        const synced = await syncGuestCartToAccount(queryClient);
        if (!cancelled && synced) previousUserId.current = nextUserId;
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
  const queryClient = useQueryClient();
  const replaceCart = useMutation(replaceCartMutation());

  const readInputs = async (session: CartSession) => {
    if (session.status === "authenticated") {
      const { data } = await getCartRequest({
        headers: cartAuthorization(session),
        throwOnError: true,
      });
      return cartItemsToInputs(data);
    }
    return getGuestCartItems();
  };

  const persistInputs = async (
    session: CartSession,
    nextItems: CartItemIn[],
  ) => {
    if (session.status === "authenticated") {
      const nextCart = await replaceCart.mutateAsync({
        body: { items: nextItems },
        headers: cartAuthorization(session),
      });
      if (isCurrentCartSession(session)) {
        queryClient.setQueryData(getCartQueryKey(), nextCart);
      }
      return;
    }
    await setGuestCartItems(nextItems);
    if (isCurrentCartSession(session)) {
      queryClient.setQueryData(guestCartQueryKey, nextItems);
    }
  };

  const updateInputs = async (
    updater: (items: CartItemIn[]) => CartItemIn[],
  ) => {
    const session = captureCartSession();
    if (!session) return;
    return cartUpdateQueue.enqueue(async () => {
      if (!isCurrentCartSession(session)) return;
      const previous = await readInputs(session);
      if (!isCurrentCartSession(session)) return;
      const next = updater(previous);
      if (next === previous) return;
      try {
        await persistInputs(session, next);
      } catch (error) {
        if (session.status === "anonymous") {
          await setGuestCartItems(previous);
          if (isCurrentCartSession(session)) {
            queryClient.setQueryData(guestCartQueryKey, previous);
          }
        }
        throw error;
      }
    });
  };

  const currentInputs = async () => {
    const session = captureCartSession();
    if (!session) return [];
    return cartUpdateQueue.enqueue(async () => {
      if (!isCurrentCartSession(session)) return [];
      return readInputs(session);
    });
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
      const items = await currentInputs();
      return items.find((item) => item.item_id === itemId)?.quantity ?? 0;
    },
  };
}

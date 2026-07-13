// @vitest-environment jsdom

import type {
  CartItemIn,
  CartItemOut,
  MeResponse,
  ProductOut,
} from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getCart: vi.fn(),
  replaceCart: vi.fn(),
}));
const token = vi.hoisted(() => ({
  accessToken: null as string | null,
  revision: 0,
}));
const storage = vi.hoisted(() => ({
  clear: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@essesion/api-client", () => ({
  getCart: api.getCart,
  replaceCart: api.replaceCart,
}));
vi.mock("@essesion/api-client/query", () => ({
  getCartOptions: () => ({ queryKey: ["cart"], queryFn: api.getCart }),
  getCartQueryKey: () => ["cart"],
  replaceCartMutation: () => ({
    mutationFn: async (options: unknown) => {
      const response = await api.replaceCart(options);
      if (!response.data) throw new Error("replace failed");
      return response.data;
    },
  }),
}));
vi.mock("@essesion/shared", () => ({ snackbar: vi.fn() }));
vi.mock("@/shared/lib/api-client", () => ({
  getStoreTokenSnapshot: () => ({ ...token }),
}));
vi.mock("./storage", () => ({
  clearGuestCartItems: storage.clear,
  getGuestCartItems: storage.get,
  guestCartQueryKey: ["guest-cart"],
  setGuestCartItems: storage.set,
}));

import { useSession } from "@/shared/store/session";
import { syncGuestCartToAccount, useCartActions } from "./use-cart";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function user(id: string) {
  return { id } as MeResponse;
}

function setAuthenticated(id: string, accessToken: string) {
  token.accessToken = accessToken;
  token.revision += 1;
  useSession.setState({
    status: "authenticated",
    accessToken,
    user: user(id),
  });
}

function setAnonymous() {
  token.accessToken = null;
  token.revision += 1;
  useSession.setState({ status: "anonymous", accessToken: null, user: null });
}

function serverItem(quantity = 1) {
  return {
    item_id: "product:1:base",
    item_type: "product",
    product: { id: 1 },
    selected_option_id: null,
    selected_option: null,
    quantity,
    reform_data: null,
    applied_coupon: null,
    availability: "available",
  } as CartItemOut;
}

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("cart session queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.get.mockResolvedValue([]);
    storage.set.mockResolvedValue(undefined);
    storage.clear.mockResolvedValue(undefined);
  });

  it("새 토큰의 사용자 재검증 중에는 기존 사용자 화면에서 변경을 보내지 않는다", async () => {
    setAuthenticated("user-a", "access-a");
    token.accessToken = "access-b";
    token.revision += 1;
    useSession.getState().setAccessToken("access-b");
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useCartActions(), {
      wrapper: wrapper(queryClient),
    });

    await act(async () => {
      await result.current.updateQuantity("product:1:base", 2);
    });

    expect(useSession.getState().status).toBe("loading");
    expect(api.getCart).not.toHaveBeenCalled();
    expect(api.replaceCart).not.toHaveBeenCalled();
    queryClient.clear();
  });

  it("A가 예약한 변경을 계정 전환 뒤 B 장바구니에 적용하지 않는다", async () => {
    setAuthenticated("user-a", "access-a");
    api.getCart.mockResolvedValue({ data: [serverItem()] });
    const firstReplace = deferred<{ data: CartItemOut[] }>();
    api.replaceCart.mockReturnValue(firstReplace.promise);
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useCartActions(), {
      wrapper: wrapper(queryClient),
    });

    let first!: Promise<void>;
    let queued!: Promise<void>;
    act(() => {
      first = result.current.updateQuantity("product:1:base", 2);
      queued = result.current.updateQuantity("product:1:base", 3);
    });
    await vi.waitFor(() => expect(api.replaceCart).toHaveBeenCalledTimes(1));
    expect(api.replaceCart).toHaveBeenCalledWith({
      body: {
        items: [expect.objectContaining({ quantity: 2 })],
      },
      headers: { Authorization: "Bearer access-a" },
    });

    setAuthenticated("user-b", "access-b");
    firstReplace.resolve({ data: [serverItem(2)] });
    await act(async () => {
      await Promise.all([first, queued]);
    });

    expect(api.replaceCart).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(["cart"])).toBeUndefined();
    queryClient.clear();
  });

  it("진행 중인 guest 저장 뒤에 로그인 동기화를 직렬화한다", async () => {
    setAnonymous();
    const saved: CartItemIn[] = [];
    const guestWrite = deferred<void>();
    storage.get.mockImplementation(async () => saved);
    storage.set.mockImplementation(async (items: CartItemIn[]) => {
      await guestWrite.promise;
      saved.splice(0, saved.length, ...items);
    });
    api.getCart.mockResolvedValue({ data: [] });
    api.replaceCart.mockImplementation(
      async ({ body }: { body: { items: CartItemIn[] } }) => ({
        data: body.items.map(() => serverItem()),
      }),
    );
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useCartActions(), {
      wrapper: wrapper(queryClient),
    });

    let guestUpdate!: Promise<void>;
    act(() => {
      guestUpdate = result.current.addProduct({
        product: { id: 1 } as ProductOut,
        quantity: 1,
      });
    });
    await vi.waitFor(() => expect(storage.set).toHaveBeenCalledTimes(1));

    setAuthenticated("user-b", "access-b");
    const syncing = syncGuestCartToAccount(queryClient);
    expect(api.getCart).not.toHaveBeenCalled();

    guestWrite.resolve();
    await act(async () => {
      await Promise.all([guestUpdate, syncing]);
    });

    expect(api.replaceCart).toHaveBeenCalledWith({
      body: {
        items: [expect.objectContaining({ item_id: "product:1:base" })],
      },
      headers: { Authorization: "Bearer access-b" },
    });
    expect(storage.clear).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });
});

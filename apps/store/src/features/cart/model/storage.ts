import type { CartItemIn } from "@essesion/api-client";

export const guestCartQueryKey = ["cart", "guest"] as const;
const GUEST_CART_KEY = "essesion:cart:guest:v1";

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isCartItemIn(value: unknown): value is CartItemIn {
  if (!isObject(value)) return false;
  if (typeof value.item_id !== "string") return false;
  if (value.item_type !== "product" && value.item_type !== "reform") {
    return false;
  }
  if (typeof value.quantity !== "number" || value.quantity < 1) return false;
  if (
    value.item_type === "product" &&
    value.product_id != null &&
    typeof value.product_id !== "number"
  ) {
    return false;
  }
  return true;
}

function parseItems(raw: string | null): CartItemIn[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const items =
      isObject(parsed) && Array.isArray(parsed.items) ? parsed.items : [];
    return items.filter(isCartItemIn);
  } catch {
    return [];
  }
}

export async function getGuestCartItems(): Promise<CartItemIn[]> {
  try {
    return parseItems(localStorage.getItem(GUEST_CART_KEY));
  } catch {
    return [];
  }
}

export async function setGuestCartItems(items: CartItemIn[]): Promise<void> {
  const validItems = items.filter(isCartItemIn);
  localStorage.setItem(GUEST_CART_KEY, JSON.stringify({ items: validItems }));
}

export async function clearGuestCartItems(): Promise<void> {
  localStorage.removeItem(GUEST_CART_KEY);
}

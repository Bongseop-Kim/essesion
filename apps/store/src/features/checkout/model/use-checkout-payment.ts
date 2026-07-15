import { snackbar } from "@essesion/shared";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/shared/store/session";

import type { PaymentWidgetHandle } from "../ui/payment-widget";

export const CHECKOUT_PENDING_KEY = "checkout:pending";
export const CHECKOUT_PENDING_TTL_MS = 29 * 60 * 1000;

type CreatedPayment = {
  paymentGroupId: string;
  totalAmount: number;
};

export type PendingCheckout<T = unknown> = CreatedPayment & {
  ownerUserId: string;
  createdAt: number;
  signature: string;
  snapshot: T;
};

function pendingCheckoutStorageKey(key: string, ownerUserId: string) {
  return `${key}:user:${encodeURIComponent(ownerUserId)}`;
}

function removePendingCheckoutItem(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Storage 접근이 차단된 브라우저에서도 결제 화면 자체는 계속 동작한다.
  }
}

export function readPendingCheckout<T>(
  key: string,
  ownerUserId: string | null,
  now = Date.now(),
): PendingCheckout<T> | null {
  // v1은 owner 정보가 없어 현재 계정의 주문이라고 안전하게 판정할 수 없다.
  removePendingCheckoutItem(key);
  if (!ownerUserId) return null;

  const scopedKey = pendingCheckoutStorageKey(key, ownerUserId);
  try {
    const value = JSON.parse(
      sessionStorage.getItem(scopedKey) ?? "null",
    ) as unknown;
    if (!value || typeof value !== "object") return null;
    const pending = value as Record<string, unknown>;
    const age =
      typeof pending.createdAt === "number"
        ? now - pending.createdAt
        : Number.NaN;
    if (
      pending.ownerUserId !== ownerUserId ||
      typeof pending.createdAt !== "number" ||
      !Number.isFinite(pending.createdAt) ||
      !Number.isInteger(pending.createdAt) ||
      age < 0 ||
      age >= CHECKOUT_PENDING_TTL_MS ||
      typeof pending.signature !== "string" ||
      typeof pending.paymentGroupId !== "string" ||
      typeof pending.totalAmount !== "number" ||
      !Number.isFinite(pending.totalAmount) ||
      !("snapshot" in pending)
    ) {
      removePendingCheckoutItem(scopedKey);
      return null;
    }
    return pending as PendingCheckout<T>;
  } catch {
    removePendingCheckoutItem(scopedKey);
    return null;
  }
}

export function clearPendingCheckout(key: string, ownerUserId: string | null) {
  removePendingCheckoutItem(key);
  if (ownerUserId) {
    removePendingCheckoutItem(pendingCheckoutStorageKey(key, ownerUserId));
  }
}

export type PaymentOwnerState = "current" | "loading" | "different";

export function paymentOwnerState(
  ownerUserId: string | null,
): PaymentOwnerState {
  const session = useSession.getState();
  if (session.status === "loading") return "loading";
  return session.status === "authenticated" &&
    ownerUserId !== null &&
    session.user?.id === ownerUserId
    ? "current"
    : "different";
}

export function waitForSettledPaymentOwner(
  ownerUserId: string | null,
): Promise<Exclude<PaymentOwnerState, "loading">> {
  const current = paymentOwnerState(ownerUserId);
  if (current !== "loading") return Promise.resolve(current);

  return new Promise((resolve) => {
    const unsubscribe = useSession.subscribe(() => {
      const next = paymentOwnerState(ownerUserId);
      if (next === "loading") return;
      unsubscribe();
      resolve(next);
    });
  });
}

export function useCheckoutPayment<T>({
  createOrder,
  orderName,
  expectedAmount,
  failPath = "/order/payment/fail",
  ownerUserId,
  storageKey,
  successPath = "/order/payment/success",
  snapshot,
}: {
  createOrder: () => Promise<CreatedPayment>;
  orderName: string;
  expectedAmount?: number;
  failPath?: string;
  ownerUserId: string | null;
  storageKey: string;
  successPath?: string;
  snapshot: T;
}) {
  const [isPending, setPending] = useState(false);
  const submitting = useRef(false);
  const currentOwner = useRef(ownerUserId);
  const mounted = useRef(true);
  currentOwner.current = ownerUserId;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return {
    isPending,
    async pay(widget: PaymentWidgetHandle | null) {
      if (submitting.current) return;
      if (!widget) {
        snackbar("결제 수단을 불러오는 중입니다.");
        return;
      }

      submitting.current = true;
      setPending(true);
      try {
        const paymentOwner = ownerUserId;
        if (!paymentOwner) {
          snackbar("로그인 정보를 확인하고 있습니다.");
          return;
        }
        const signature = JSON.stringify(snapshot);
        const cached = readPendingCheckout<T>(storageKey, paymentOwner);
        const reusable = cached?.signature === signature ? cached : null;
        const payment = reusable ?? (await createOrder());

        // 금액 불일치여도 생성된 주문을 pending으로 보존 — 버리면 재시도마다
        // 새 주문이 쌓이고, 예약된 쿠폰이 stale 취소 배치 전까지 잠긴다.
        const pending: PendingCheckout<T> = {
          ...payment,
          ownerUserId: paymentOwner,
          createdAt: reusable?.createdAt ?? Date.now(),
          signature,
          snapshot,
        };
        sessionStorage.setItem(
          pendingCheckoutStorageKey(storageKey, paymentOwner),
          JSON.stringify(pending),
        );

        // 주문 생성 중 계정이 바뀌었다면 원래 소유자 namespace에만 보존하고
        // 새 계정 화면에서는 Toss 결제를 시작하지 않는다.
        if (!mounted.current || currentOwner.current !== paymentOwner) return;

        if (
          expectedAmount !== undefined &&
          payment.totalAmount !== expectedAmount
        ) {
          snackbar(
            "결제 금액이 변경되었습니다. 장바구니를 다시 확인해 주세요.",
          );
          return;
        }
        await widget.setAmount(payment.totalAmount);
        if (!mounted.current || currentOwner.current !== paymentOwner) return;
        await widget.requestPayment({
          orderId: payment.paymentGroupId,
          orderName,
          successUrl: `${window.location.origin}${successPath}`,
          failUrl: `${window.location.origin}${failPath}`,
        });
      } catch (error) {
        if (!isUserCancel(error)) snackbar("결제를 시작하지 못했습니다.");
      } finally {
        submitting.current = false;
        if (mounted.current) setPending(false);
      }
    },
  };
}

function isUserCancel(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = String((error as { code: unknown }).code);
  return code === "USER_CANCEL" || code === "PAY_PROCESS_CANCELED";
}

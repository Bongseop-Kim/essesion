import { snackbar } from "@essesion/shared";
import { useRef, useState } from "react";

import type { PaymentWidgetHandle } from "../ui/payment-widget";

export const CHECKOUT_PENDING_KEY = "checkout:pending";

type CreatedPayment = {
  paymentGroupId: string;
  totalAmount: number;
};

export type PendingCheckout<T = unknown> = CreatedPayment & {
  signature: string;
  snapshot: T;
};

export function readPendingCheckout<T>(key: string): PendingCheckout<T> | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as unknown;
    if (!value || typeof value !== "object") return null;
    const pending = value as Record<string, unknown>;
    if (
      typeof pending.signature !== "string" ||
      typeof pending.paymentGroupId !== "string" ||
      typeof pending.totalAmount !== "number" ||
      !("snapshot" in pending)
    ) {
      return null;
    }
    return pending as PendingCheckout<T>;
  } catch {
    return null;
  }
}

export function clearPendingCheckout(key: string) {
  sessionStorage.removeItem(key);
}

export function useCheckoutPayment<T>({
  createOrder,
  orderName,
  expectedAmount,
  failPath = "/order/payment/fail",
  storageKey,
  successPath = "/order/payment/success",
  snapshot,
}: {
  createOrder: () => Promise<CreatedPayment>;
  orderName: string;
  expectedAmount?: number;
  failPath?: string;
  storageKey: string;
  successPath?: string;
  snapshot: T;
}) {
  const [isPending, setPending] = useState(false);
  const submitting = useRef(false);

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
        const signature = JSON.stringify(snapshot);
        const cached = readPendingCheckout<T>(storageKey);
        const payment =
          cached?.signature === signature ? cached : await createOrder();

        if (
          expectedAmount !== undefined &&
          payment.totalAmount !== expectedAmount
        ) {
          clearPendingCheckout(storageKey);
          snackbar(
            "결제 금액이 변경되었습니다. 장바구니를 다시 확인해 주세요.",
          );
          return;
        }

        const pending: PendingCheckout<T> = {
          ...payment,
          signature,
          snapshot,
        };
        sessionStorage.setItem(storageKey, JSON.stringify(pending));
        await widget.setAmount(payment.totalAmount);
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
        setPending(false);
      }
    },
  };
}

function isUserCancel(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = String((error as { code: unknown }).code);
  return code === "USER_CANCEL" || code === "PAY_PROCESS_CANCELED";
}

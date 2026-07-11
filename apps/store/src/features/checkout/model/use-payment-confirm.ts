// ponytail: 줄수 이득은 미미 — Toss successUrl 콜백의 멱등 confirm 스캐폴드
// (파라미터 검증·started 가드·실패 재시도)를 주문/토큰 결제가 한 벌로 쓰는 게 목적.
import type { PaymentConfirmResponse } from "@essesion/api-client";
import { confirmPaymentMutation } from "@essesion/api-client/query";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

export function usePaymentConfirm<T>(
  onConfirmed: (result: PaymentConfirmResponse) => Promise<T>,
) {
  const [params] = useSearchParams();
  const paymentKey = params.get("paymentKey");
  const orderId = params.get("orderId");
  const amount = Number(params.get("amount"));
  const valid =
    !!paymentKey && !!orderId && Number.isInteger(amount) && amount > 0;
  const confirm = useMutation(confirmPaymentMutation());
  const [confirmed, setConfirmed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [data, setData] = useState<T | null>(null);
  const started = useRef(false);
  const handler = useRef(onConfirmed);
  handler.current = onConfirmed;

  const retry = useCallback(async () => {
    if (!valid || !paymentKey || !orderId) return;
    setFailed(false);
    try {
      const result = await confirm.mutateAsync({
        body: {
          payment_key: paymentKey,
          payment_group_id: orderId,
          amount,
        },
      });
      setData(await handler.current(result));
      setConfirmed(true);
    } catch {
      setFailed(true);
    }
  }, [amount, confirm, orderId, paymentKey, valid]);

  useEffect(() => {
    if (started.current || !valid) return;
    started.current = true;
    void retry();
  }, [retry, valid]);

  return {
    valid,
    confirmed,
    failed,
    data,
    isPending: confirm.isPending,
    retry,
  };
}

// ponytail: 줄수 이득은 미미 — Toss successUrl 콜백의 멱등 confirm 스캐폴드
// (파라미터 검증·started 가드·실패 재시도)를 주문/토큰 결제가 한 벌로 쓰는 게 목적.
import type { PaymentConfirmResponse } from "@essesion/api-client";
import { confirmPaymentMutation } from "@essesion/api-client/query";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

type PaymentConfirmOptions = {
  onTerminalFailure?: (error: unknown, paymentGroupId: string) => void;
};

export function usePaymentConfirm<T>(
  onConfirmed: (
    result: PaymentConfirmResponse,
    paymentGroupId: string,
  ) => Promise<T>,
  options: PaymentConfirmOptions = {},
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
  const terminalFailureHandler = useRef(options.onTerminalFailure);
  terminalFailureHandler.current = options.onTerminalFailure;

  const retry = useCallback(async () => {
    if (!valid || !paymentKey || !orderId) return;
    const onConfirmedForAttempt = handler.current;
    const onTerminalFailureForAttempt = terminalFailureHandler.current;
    setFailed(false);
    try {
      const result = await confirm.mutateAsync({
        body: {
          payment_key: paymentKey,
          payment_group_id: orderId,
          amount,
        },
      });
      setData(await onConfirmedForAttempt(result, orderId));
      setConfirmed(true);
    } catch (error) {
      if (isTerminalPaymentFailure(error)) {
        onTerminalFailureForAttempt?.(error, orderId);
      }
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

export function isTerminalPaymentFailure(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = String((error as { code: unknown }).code);
  return (
    code === "not_payable" ||
    code === "not_found" ||
    code === "forbidden" ||
    code === "ownership_conflict"
  );
}

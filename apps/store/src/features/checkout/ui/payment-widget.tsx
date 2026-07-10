import { ContentPlaceholder, Skeleton, VStack } from "@essesion/shared";
import {
  loadTossPayments,
  type TossPaymentsWidgets,
} from "@tosspayments/tosspayments-sdk";
import type { Ref } from "react";
import { useEffect, useId, useImperativeHandle, useRef, useState } from "react";

export type PaymentRequest = {
  orderId: string;
  orderName: string;
  successUrl: string;
  failUrl: string;
};

export type PaymentWidgetHandle = {
  setAmount: (amount: number) => Promise<void>;
  requestPayment: (request: PaymentRequest) => Promise<void>;
};

export function PaymentWidget({
  amount,
  customerKey,
  onReadyChange,
  ref,
}: {
  amount: number;
  customerKey: string;
  onReadyChange?: (ready: boolean) => void;
  ref?: Ref<PaymentWidgetHandle>;
}) {
  const id = useId().replaceAll(":", "");
  const widgetsRef = useRef<TossPaymentsWidgets | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const clientKey = import.meta.env.VITE_TOSS_CLIENT_KEY;

  useImperativeHandle(
    ref,
    () => ({
      async setAmount(nextAmount) {
        if (!widgetsRef.current) throw new Error("payment widget is not ready");
        await widgetsRef.current.setAmount({
          currency: "KRW",
          value: nextAmount,
        });
      },
      async requestPayment(request) {
        if (!widgetsRef.current) throw new Error("payment widget is not ready");
        await widgetsRef.current.requestPayment(request);
      },
    }),
    [],
  );

  useEffect(() => {
    onReadyChange?.(ready);
  }, [onReadyChange, ready]);

  useEffect(() => {
    let cancelled = false;
    if (!clientKey) {
      setError(true);
      return;
    }

    (async () => {
      try {
        const tossPayments = await loadTossPayments(clientKey);
        if (cancelled) return;
        const widgets = tossPayments.widgets({ customerKey });
        widgetsRef.current = widgets;
        await widgets.setAmount({ currency: "KRW", value: amount });
        await Promise.all([
          widgets.renderPaymentMethods({ selector: `#payment-method-${id}` }),
          widgets.renderAgreement({
            selector: `#payment-agreement-${id}`,
            variantKey: "AGREEMENT",
          }),
        ]);
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setError(true);
      }
    })();

    return () => {
      cancelled = true;
      widgetsRef.current = null;
    };
  }, [customerKey, id]);

  useEffect(() => {
    if (!ready || !widgetsRef.current) return;
    widgetsRef.current
      .setAmount({ currency: "KRW", value: amount })
      .catch(() => setError(true));
  }, [amount, ready]);

  if (error) {
    return (
      <ContentPlaceholder
        title="결제 수단을 불러오지 못했습니다"
        description="환경 설정을 확인한 뒤 새로고침해 주세요."
      />
    );
  }

  return (
    <VStack gap="x2" alignItems="stretch" aria-busy={!ready}>
      {!ready ? <Skeleton width="100%" height={160} /> : null}
      <div id={`payment-method-${id}`} />
      <div id={`payment-agreement-${id}`} />
    </VStack>
  );
}

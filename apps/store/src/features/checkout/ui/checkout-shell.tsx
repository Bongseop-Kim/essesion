import { VStack } from "@essesion/shared";
import { type ComponentProps, type ReactNode, useRef, useState } from "react";

import { ContentLayout } from "@/shared/ui/content-layout";
import { PaymentActionBar } from "@/shared/ui/payment-action-bar";

import { PaymentWidget, type PaymentWidgetHandle } from "./payment-widget";

export function CheckoutShell({
  amount,
  breadcrumbs,
  children,
  customerKey,
  helperText,
  onPay,
  payDisabled,
  payLoading,
  summary,
}: {
  amount: number;
  breadcrumbs: ComponentProps<typeof ContentLayout>["breadcrumbs"];
  children: ReactNode;
  customerKey: string | null;
  helperText?: string;
  onPay: (widget: PaymentWidgetHandle | null) => void;
  payDisabled: boolean;
  payLoading: boolean;
  summary: ReactNode;
}) {
  const [widgetReady, setWidgetReady] = useState(false);
  const widgetRef = useRef<PaymentWidgetHandle | null>(null);

  return (
    <ContentLayout
      breadcrumbs={breadcrumbs}
      sidebar={
        <VStack gap="x6" alignItems="stretch">
          {summary}
          {customerKey ? (
            <PaymentWidget
              ref={widgetRef}
              amount={amount}
              customerKey={customerKey}
              onReadyChange={setWidgetReady}
            />
          ) : null}
        </VStack>
      }
      actionBar={
        <PaymentActionBar
          amount={amount}
          disabled={payDisabled || !widgetReady}
          loading={payLoading}
          helperText={helperText}
          onClick={() => onPay(widgetRef.current)}
        />
      }
    >
      {children}
    </ContentLayout>
  );
}

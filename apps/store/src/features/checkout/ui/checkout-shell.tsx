import { ActionButton, Box, Callout, Text, VStack } from "@essesion/shared";
import { type ComponentProps, type ReactNode, useRef, useState } from "react";
import { krw } from "@/shared/lib/format";
import { ContentLayout } from "@/shared/ui/content-layout";

import { PaymentWidget, type PaymentWidgetHandle } from "./payment-widget";

export function CheckoutShell({
  amount,
  blockedMessage,
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
  /** 결제를 멈춘 이유 — 조치할 때까지 결제 버튼 위에 남는다. */
  blockedMessage?: string | null;
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
        <VStack gap="x2" alignItems="stretch">
          {blockedMessage ? (
            <Callout tone="critical" description={blockedMessage} />
          ) : null}
          {helperText ? (
            <Text textStyle="caption" color="fg.neutral-muted" align="center">
              {helperText}
            </Text>
          ) : null}
          <Box
            as={ActionButton}
            type="button"
            size="large"
            width="full"
            disabled={payDisabled || !widgetReady}
            loading={payLoading}
            onClick={() => onPay(widgetRef.current)}
          >
            {krw.format(amount)}원 결제하기
          </Box>
        </VStack>
      }
    >
      {children}
    </ContentLayout>
  );
}

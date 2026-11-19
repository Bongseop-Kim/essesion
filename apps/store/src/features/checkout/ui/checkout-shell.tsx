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
  const widgetAreaRef = useRef<HTMLDivElement>(null);
  const actionBarRef = useRef<HTMLDivElement>(null);
  // 결제 수단으로 한 번 데려갔으면 다시 끄지 않는다 — 위젯이 화면보다 크면 좌표 조건이 끝내 참이 안 된다
  const paymentSeen = useRef(false);

  const handlePay = () => {
    const area = widgetAreaRef.current;
    const bar = actionBarRef.current;
    // 데스크톱은 버튼이 위젯 바로 아래라 항상 참
    const methodsVisible =
      !area ||
      !bar ||
      area.getBoundingClientRect().bottom <= bar.getBoundingClientRect().top;
    if (paymentSeen.current || methodsVisible) {
      onPay(widgetRef.current);
      return;
    }
    paymentSeen.current = true;
    area.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
    // preventScroll이 없으면 focus가 즉시 점프해 smooth 스크롤이 끊긴다
    area.focus({ preventScroll: true });
  };

  return (
    <ContentLayout
      breadcrumbs={breadcrumbs}
      sidebar={
        <VStack gap="x6" alignItems="stretch">
          {summary}
          {customerKey ? (
            <Box
              ref={widgetAreaRef}
              tabIndex={-1}
              className="outline-none"
              style={{ scrollMarginTop: "var(--spacing-x16)" }}
            >
              <PaymentWidget
                ref={widgetRef}
                amount={amount}
                customerKey={customerKey}
                onReadyChange={setWidgetReady}
              />
            </Box>
          ) : null}
        </VStack>
      }
      actionBar={
        <VStack ref={actionBarRef} gap="x2" alignItems="stretch">
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
            onClick={handlePay}
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

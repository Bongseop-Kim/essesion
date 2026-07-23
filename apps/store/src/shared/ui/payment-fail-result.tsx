import { ContentPlaceholder, Text, VStack } from "@essesion/shared";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router";

import { ResultEmoji } from "@/shared/ui/result-emoji";
import { ResultPageLayout } from "@/shared/ui/result-page-layout";

/** Toss 결제 실패 결과 화면 — code/message 쿼리를 파싱하고 액션만 페이지가 넘긴다. */
export function PaymentFailResult({
  title,
  action,
}: {
  title: string;
  action: ReactNode;
}) {
  const [params] = useSearchParams();
  const code = params.get("code") ?? "UNKNOWN";
  const message = params.get("message") ?? "결제를 완료하지 못했습니다.";
  return (
    <ResultPageLayout>
      <ContentPlaceholder
        icon={<ResultEmoji emoji="😢" />}
        title={title}
        description={
          <VStack gap="x1" align="center">
            <Text textStyle="bodySm" color="fg.neutral-muted">
              {message}
            </Text>
            <Text textStyle="caption" color="fg.neutral-muted">
              오류 코드: {code}
            </Text>
          </VStack>
        }
        action={action}
      />
    </ResultPageLayout>
  );
}

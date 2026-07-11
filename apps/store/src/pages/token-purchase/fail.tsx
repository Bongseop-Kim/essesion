import {
  ActionButton,
  ContentPlaceholder,
  Text,
  VStack,
} from "@essesion/shared";
import { useNavigate, useSearchParams } from "react-router";

import { ResultEmoji } from "@/shared/ui/result-emoji";
import { ResultPageLayout } from "@/shared/ui/result-page-layout";

export function TokenPurchaseFailPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const code = params.get("code") ?? "UNKNOWN";
  const message = params.get("message") ?? "결제를 완료하지 못했습니다.";
  return (
    <ResultPageLayout>
      <ContentPlaceholder
        icon={<ResultEmoji emoji="😢" />}
        title="토큰 결제가 완료되지 않았습니다"
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
        action={
          <ActionButton onClick={() => navigate("/token/purchase")}>
            토큰 구매로 돌아가기
          </ActionButton>
        }
      />
    </ResultPageLayout>
  );
}

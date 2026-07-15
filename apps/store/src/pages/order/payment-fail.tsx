import {
  ActionButton,
  ContentPlaceholder,
  Text,
  VStack,
} from "@essesion/shared";
import { useNavigate, useSearchParams } from "react-router";

import { CHECKOUT_PENDING_KEY, readPendingCheckout } from "@/features/checkout";
import { useSession } from "@/shared/store/session";
import { ResultEmoji } from "@/shared/ui/result-emoji";
import { ResultPageLayout } from "@/shared/ui/result-page-layout";

export function PaymentFailPage() {
  const navigate = useNavigate();
  const ownerUserId = useSession((state) => state.user?.id ?? null);
  const [params] = useSearchParams();
  const code = params.get("code") ?? "UNKNOWN";
  const message = params.get("message") ?? "결제를 완료하지 못했습니다.";

  return (
    <ResultPageLayout>
      <ContentPlaceholder
        icon={<ResultEmoji emoji="😢" />}
        title="결제가 완료되지 않았습니다"
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
          <ActionButton
            type="button"
            onClick={() => {
              const pending = readPendingCheckout<{
                cartItemIds?: string[];
                returnPath?: string;
                returnState?: unknown;
              }>(CHECKOUT_PENDING_KEY, ownerUserId);
              navigate(pending?.snapshot.returnPath ?? "/order/order-form", {
                state: pending?.snapshot.returnState ?? {
                  cartItemIds: pending?.snapshot.cartItemIds,
                },
              });
            }}
          >
            주문서로 돌아가기
          </ActionButton>
        }
      />
    </ResultPageLayout>
  );
}

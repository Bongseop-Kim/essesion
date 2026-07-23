import { ActionButton } from "@essesion/shared";
import { useNavigate } from "react-router";

import { CHECKOUT_PENDING_KEY, readPendingCheckout } from "@/features/checkout";
import { useSession } from "@/shared/store/session";
import { PaymentFailResult } from "@/shared/ui/payment-fail-result";

export function PaymentFailPage() {
  const navigate = useNavigate();
  const ownerUserId = useSession((state) => state.user?.id ?? null);

  return (
    <PaymentFailResult
      title="결제가 완료되지 않았습니다"
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
  );
}

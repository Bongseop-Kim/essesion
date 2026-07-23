import { ActionButton } from "@essesion/shared";
import { useNavigate } from "react-router";

import { PaymentFailResult } from "@/shared/ui/payment-fail-result";

export function TokenPurchaseFailPage() {
  const navigate = useNavigate();
  return (
    <PaymentFailResult
      title="토큰 결제가 완료되지 않았습니다"
      action={
        <ActionButton onClick={() => navigate("/token/purchase")}>
          토큰 구매로 돌아가기
        </ActionButton>
      }
    />
  );
}

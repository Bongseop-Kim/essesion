import { getReformPricingOptions } from "@essesion/api-client/query";
import { useQuery } from "@tanstack/react-query";

import { krw } from "@/shared/lib/format";

/** FAQ·공지 본문의 수선 요금 플레이스홀더 치환값과 로딩/에러 안내 문구. */
export function useReformPricingTokens() {
  const pricingQuery = useQuery(getReformPricingOptions());
  const fees = {
    REFORM_SHIPPING_COST: pricingQuery.data
      ? krw.format(pricingQuery.data.shipping_cost)
      : "—",
    REFORM_PICKUP_FEE: pricingQuery.data
      ? krw.format(pricingQuery.data.pickup_fee)
      : "—",
  };
  const pricingStatus = pricingQuery.isError
    ? "수선 배송 요금을 불러오지 못했습니다. 관련 금액은 —로 표시됩니다."
    : pricingQuery.isPending
      ? "수선 배송 요금을 불러오는 중입니다. 관련 금액은 잠시 —로 표시됩니다."
      : null;
  const applyReformFees = (text: string) =>
    text
      .replaceAll("{{REFORM_SHIPPING_COST}}", fees.REFORM_SHIPPING_COST)
      .replaceAll("{{REFORM_PICKUP_FEE}}", fees.REFORM_PICKUP_FEE);
  return { pricingStatus, applyReformFees };
}

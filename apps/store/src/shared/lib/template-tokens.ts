export type TemplateToken = "REFORM_SHIPPING_COST" | "REFORM_PICKUP_FEE";

export type TemplateTokenValues = Partial<Record<TemplateToken, string>>;

const TOKEN_PATTERN = /{{(REFORM_SHIPPING_COST|REFORM_PICKUP_FEE)}}/g;

/** 정적 안내문 안의 알려진 요금 토큰을 치환한다. 값이 없으면 문서를 막지 않고 —를 표시한다. */
export function applyTemplateTokens(
  template: string,
  values: TemplateTokenValues,
): string {
  return template.replace(
    TOKEN_PATTERN,
    (_match, token: TemplateToken) => values[token] ?? "—",
  );
}

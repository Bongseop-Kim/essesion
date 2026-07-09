import { zodResolver } from "@hookform/resolvers/zod";
import { type UseFormProps, useForm } from "react-hook-form";
import type { z } from "zod";

/**
 * RHF + zod 표준 폼 훅. api-client 생성 zod 스키마(또는 그것을 .extend/.refine한 UI 스키마)를
 * 그대로 넘긴다 — 검증이 API 계약과 단일 소스가 된다.
 *
 * 여기 가두는 것(각 폼이 재발명하지 않도록):
 * - zod v4 제네릭 추론 함정 회피: 제약을 `z.ZodType<any, any>`로 둔다. 그냥 `z.ZodType`면
 *   v4에서 input/output이 unknown으로 추론돼 필드 타입이 깨진다 (RHF Discussion 13205).
 * - input/output 분리: `useForm<z.input, ctx, z.output>` — coerce/transform 스키마도
 *   폼 값(input)과 제출 값(output) 타입이 정확해진다.
 * - 공통 UX: mode="onTouched"(첫 blur 후 검증→이후 onChange 재검증). 에러 자동 포커스는
 *   RHF 기본(shouldFocusError). props로 개별 오버라이드 가능.
 */
// biome-ignore lint/suspicious/noExplicitAny: zod v4 추론 유지에 필요 (RHF discussion 13205)
export function useZodForm<S extends z.ZodType<any, any>>(
  schema: S,
  // biome-ignore lint/suspicious/noExplicitAny: TContext 위치 — RHF 관례상 any
  props?: Omit<UseFormProps<z.input<S>, any, z.output<S>>, "resolver">,
) {
  // biome-ignore lint/suspicious/noExplicitAny: 위와 동일 (TContext)
  return useForm<z.input<S>, any, z.output<S>>({
    mode: "onTouched",
    ...props,
    resolver: zodResolver(schema),
  });
}

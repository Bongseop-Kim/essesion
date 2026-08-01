import { z } from "zod";

/**
 * 화면이 실제로 읽는 턴 payload만 파싱한다.
 *
 * 서버는 `generate_request`·`motif_activate`·`finalize` 턴도 남기지만 캔버스 셸은
 * 편집 이력(성공 스텝·실패 칸)과 편집 포인터만 그린다 — 나머지는 파싱 대상이 아니다.
 */

const designSchema = z
  .object({
    id: z.string().min(1),
    seed: z.number().int(),
    colorway_id: z.string().min(1),
    svg: z.string().min(1),
  })
  .passthrough();

// 로그가 손상된 턴은 api가 response를 생략한다 — 썸네일을 그릴 수 없으므로 파싱 실패로 둔다.
// `response.warnings`는 엔진 영문 진단 문자열이라 읽지 않는다 — 고객 문구는 생성 응답이 준다.
const generatePayloadSchema = z
  .object({
    type: z.literal("generate"),
    run_id: z.string().uuid(),
    status: z.literal("succeeded"),
    summary: z.string().nullable().optional(),
    response: z
      .object({
        run_id: z.string().uuid(),
        design: designSchema,
      })
      .passthrough(),
  })
  .passthrough();

const generateErrorPayloadSchema = z
  .object({
    type: z.literal("generate_error"),
    run_id: z.string().uuid().nullable(),
    status: z.literal("error"),
    error: z
      .object({ stage: z.string().min(1), code: z.string().min(1) })
      .nullable()
      .optional(),
  })
  .passthrough();

const activatePayloadSchema = z
  .object({
    type: z.literal("activate"),
    run_id: z.string().uuid(),
  })
  .passthrough();

const designTurnPayloadSchema = z.discriminatedUnion("type", [
  generatePayloadSchema,
  generateErrorPayloadSchema,
  activatePayloadSchema,
]);

export type DesignTurnPayload = z.infer<typeof designTurnPayloadSchema>;

export function parseDesignTurnPayload(
  value: unknown,
): DesignTurnPayload | null {
  const parsed = designTurnPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

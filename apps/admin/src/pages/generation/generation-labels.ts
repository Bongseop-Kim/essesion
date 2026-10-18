export const GENERATION_MODE_LABELS: Readonly<Record<string, string>> = {
  variation: "같은 의도로 다시 그리기",
  motif_slot: "모티프 교체",
};

const INPUT_TYPE_LABELS: Readonly<Record<string, string>> = {
  intent: "디자인 의도",
};

export function inputTypeLabel(inputType: string) {
  return INPUT_TYPE_LABELS[inputType] ?? "알 수 없는 입력 방식";
}

export const FAILURE_STAGE_LABELS: Readonly<Record<string, string>> = {
  constraints: "사용자 설정",
  intent: "의도 검증",
  design: "디자인 합성",
};

/** 워커가 기록하는 실패 코드 (worker/api/routes.py의 GENERATION_ERROR_MESSAGES) */
export const FAILURE_CODE_LABELS: Readonly<Record<string, string>> = {
  constraint_conflict: "설정 충돌",
  design_invalid: "디자인 합성 실패",
  intent_invalid: "의도 검증 실패",
};

export const GENERATION_MODE_LABELS: Readonly<Record<string, string>> = {
  prompt: "프롬프트 생성",
  patch: "구성 수정",
  variation: "같은 intent 재렌더",
  motif_slot: "모티프 교체",
};

/** 구성 수정 patch가 실제로 바꾼 축 (worker/engine/patch.py의 PATCH_AXES) */
export const PATCH_AXIS_LABELS: Readonly<Record<string, string>> = {
  background: "바탕색",
  stripe: "줄무늬",
  placement: "배치",
  motif_size_mm: "무늬 크기",
  palette: "팔레트",
};

export const INPUT_TYPE_LABELS: Readonly<Record<string, string>> = {
  intent: "구조화된 디자인 의도",
  prompt: "텍스트 프롬프트",
};

export function inputTypeLabel(inputType: string) {
  return INPUT_TYPE_LABELS[inputType] ?? "알 수 없는 입력 방식";
}

export const FAILURE_STAGE_LABELS: Readonly<Record<string, string>> = {
  constraints: "사용자 설정",
  authoring: "계획 저작",
  intent: "Intent 검증",
  motif_resolution: "모티프 해석",
  design: "디자인 합성",
};

/** 워커가 기록하는 실패 코드 (worker/api/routes.py의 GENERATION_ERROR_MESSAGES + patch 거절) */
export const FAILURE_CODE_LABELS: Readonly<Record<string, string>> = {
  authoring_invalid: "계획 저작 실패",
  constraint_conflict: "설정 충돌",
  design_invalid: "디자인 합성 실패",
  intent_invalid: "Intent 검증 실패",
  scope_rejected: "구성 수정 범위 밖 요청",
  semantic_mismatch: "요청 주제와 계획 불일치",
  provider_request_failed: "외부 연동 실패",
};

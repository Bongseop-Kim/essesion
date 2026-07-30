export const GENERATION_MODE_LABELS: Readonly<Record<string, string>> = {
  prompt: "프롬프트 생성",
  refine: "대화 수정",
  variation: "다시 만들기",
};

export const INPUT_TYPE_LABELS: Readonly<Record<string, string>> = {
  intent: "구조화된 디자인 의도",
  prompt: "텍스트 프롬프트",
  reference_image: "참고 이미지",
};

export function inputTypeLabel(inputType: string) {
  return INPUT_TYPE_LABELS[inputType] ?? "알 수 없는 입력 방식";
}

export const FAILURE_STAGE_LABELS: Readonly<Record<string, string>> = {
  reference: "참고 이미지",
  constraints: "사용자 설정",
  authoring: "계획 저작",
  intent: "Intent 검증",
  candidate: "후보 구성",
};

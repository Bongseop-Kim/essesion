export const GENERATION_MODE_LABELS: Readonly<Record<string, string>> = {
  prompt: "프롬프트 생성",
  variation: "다시 만들기",
};

export const FAILURE_STAGE_LABELS: Readonly<Record<string, string>> = {
  reference: "참고 이미지",
  constraints: "사용자 설정",
  authoring: "계획 저작",
  intent: "Intent 검증",
  candidate: "후보 구성",
};

/**
 * 디자인 페이지 첫 진입 코치마크 스텝 — 순서·문구의 정본.
 * 타깃은 화면 요소의 `data-coach="<key>"`로 찾고, 없거나 숨겨진 스텝은 건너뛴다
 * (예시 갤러리는 디자인이 없을 때만, 토큰은 로그인 때만, 도구는 PC 레일/모바일 + 버튼).
 * 마지막 스텝은 실사화 — 이 서비스가 고객에게 합리적인 이유를 한 번은 말한다.
 */
export type CoachStep = {
  key: string;
  title: string;
  description: string;
};

export const COACH_STEPS: readonly CoachStep[] = [
  {
    key: "starter",
    title: "예시로 바로 시작",
    description:
      "마음에 드는 예시를 누르면 그 디자인에서 바로 이어서 수정할 수 있어요.",
  },
  {
    key: "prompt",
    title: "문장으로 만들고 고쳐요",
    description:
      "원하는 넥타이를 적으면 디자인이 만들어져요. 만든 뒤엔 “줄만 버건디로”처럼 바꿀 부분만 적어요. 만들어진 뒤엔 오른쪽 실사화 버튼이 켜져요.",
  },
  {
    key: "motifs",
    title: "그림(모티프) 넣기",
    description:
      "슬롯을 눌러 카탈로그에서 고르거나, AI로 만들거나, 내 SVG를 올려요. 최대 2개까지 넣을 수 있어요.",
  },
  {
    key: "history",
    title: "언제든 되돌리기",
    description:
      "수정할 때마다 단계가 쌓여요. 이전 단계를 누르면 그 디자인으로 돌아가요.",
  },
  {
    key: "view",
    title: "넥타이로, 타일로",
    description: "넥타이에 입힌 모습과 원단 반복 무늬를 번갈아 확인해요.",
  },
  {
    key: "tokens",
    title: "토큰 잔액",
    description:
      "생성·수정·모티프 생성마다 토큰이 쓰여요. 누르면 항목별 비용과 충전 버튼이 보여요.",
  },
  {
    key: "tools",
    title: "내려받기와 목록",
    description:
      "완성한 디자인을 내려받거나, 내 디자인·완성본 목록을 열거나, 새로 시작해요. 이 안내도 여기서 다시 볼 수 있어요.",
  },
  {
    // 고객 관점의 핵심: 채팅+결정론 엔진으로 느낌을 먼저 잡고, 정해진 뒤에만 이미지를 만든다.
    // 매 턴 이미지를 다시 그리는 방식은 화질이 무너지고 넥타이 패턴을 세밀히 못 다루며 비싸다.
    key: "finalize",
    title: "정해지면 실사화",
    description:
      "채팅으로 원하는 느낌을 먼저 잡고, 마음에 들 때 실사화해요. 그래야 매번 이미지를 새로 그리느라 화질이 무너지지 않고, 패턴을 세밀하게 다듬을 수 있고, 토큰도 아껴요. 디자인이 생기면 이 버튼이 켜져요.",
  },
];

export const coachTargetSelector = (key: string) => `[data-coach="${key}"]`;

/** 화면에 실제로 보이는 타깃만 — jsdom은 checkVisibility가 없어 offsetParent로 폴백한다. */
export function isCoachTargetVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return typeof el.checkVisibility === "function"
    ? el.checkVisibility()
    : el.offsetParent !== null;
}

export function findCoachTarget(key: string): HTMLElement | null {
  for (const el of document.querySelectorAll(coachTargetSelector(key))) {
    if (isCoachTargetVisible(el)) return el as HTMLElement;
  }
  return null;
}

/* 포커스 링 유틸리티 — theme.css의 stroke.focus-ring을 2px 아웃라인으로.
   문자열 리터럴로 둬 Tailwind content 스캐너가 클래스를 추출하게 한다(생성식 금지).
   버튼·필드 등 여백이 있는 요소는 focusRing(바깥 오프셋),
   행/탭처럼 꽉 찬 요소는 focusRingInset(안쪽 오프셋 — 아웃라인이 잘리지 않게). */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring";

export const focusRingInset =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-stroke-focus-ring";

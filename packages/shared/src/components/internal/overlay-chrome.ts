/* <dialog> 기반 오버레이 공통 클래스 — 문자열 리터럴로 둬 Tailwind content 스캐너가
   추출하게 한다. 면 크롬(테두리·배경·그림자)과 백드롭 페이드는 모든 오버레이가 공유하고,
   등장·퇴장 transform(scale/translate)은 각 컴포넌트가 자체 소유한다. */
export const overlaySurface =
  "border-0 bg-bg-layer-floating p-0 text-fg-neutral shadow-s3 outline-none";

export const overlayBackdrop =
  "backdrop:bg-bg-overlay backdrop:transition-opacity backdrop:duration-(--duration-slow) starting:open:backdrop:opacity-0 data-closing:backdrop:opacity-0";

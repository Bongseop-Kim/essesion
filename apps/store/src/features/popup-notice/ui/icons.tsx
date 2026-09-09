/** 팝업 공지 전용 선 그림 아이콘 — 시안(디자인 캔버스)과 같은 획. `Icon`으로 래핑해 쓴다. */

export function TruckGlyph() {
  return (
    <svg
      viewBox="0 0 56 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="10" y="12" width="26" height="19" rx="2" />
      <path d="M36 18h8l6 7v6H36" />
      <circle cx="18" cy="36" r="4" fill="var(--color-bg-layer-default)" />
      <circle cx="42" cy="36" r="4" fill="var(--color-bg-layer-default)" />
      <path d="M2 18h5M4 24h3M2 30h5" />
    </svg>
  );
}

export function BoxGlyph() {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M24 6l16 8v20l-16 8-16-8V14z" />
      <path d="M8 14l16 8 16-8M24 22v20" />
      <path d="M16 10l16 8" />
    </svg>
  );
}

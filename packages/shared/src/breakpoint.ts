import { useSyncExternalStore } from "react";

/* theme.css의 --breakpoint-*와 값 동기 (드리프트 가드 테스트가 검증) */
export const breakpoints = { sm: 480, md: 768, lg: 1280, xl: 1440 } as const;

export type Breakpoint = "base" | keyof typeof breakpoints;

export type ResponsiveValue<T> =
  | T
  | { base?: T; sm?: T; md?: T; lg?: T; xl?: T };

const ORDER = [
  "base",
  "sm",
  "md",
  "lg",
  "xl",
] as const satisfies readonly Breakpoint[];

/* ponytail: CSR 전용 JS 해석 — SSR 도입 시 seed식 CSS 변수 캐스케이드로 업그레이드 */
let queries: { bp: Breakpoint; mql: MediaQueryList }[] | undefined;

function ensureQueries() {
  queries ??= Object.entries(breakpoints).map(([bp, min]) => ({
    bp: bp as Breakpoint,
    mql: window.matchMedia(`(min-width: ${min}px)`),
  }));
  return queries;
}

function snapshot(): Breakpoint {
  if (typeof window === "undefined") return "base";
  let current: Breakpoint = "base";
  for (const { bp, mql } of ensureQueries()) {
    if (mql.matches) current = bp;
  }
  return current;
}

function subscribe(onChange: () => void) {
  const qs = ensureQueries();
  for (const { mql } of qs) {
    mql.addEventListener("change", onChange);
  }
  return () => {
    for (const { mql } of qs) {
      mql.removeEventListener("change", onChange);
    }
  };
}

/** 현재 브레이크포인트. 문자열 스냅샷이라 실제 교차 시에만 리렌더. */
export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, snapshot, () => "base");
}

/** 반응형 값에서 현재 브레이크포인트 값 선택 — 하향 fallback(xl→lg→md→sm→base). */
export function pickResponsive<T>(
  value: ResponsiveValue<T>,
  bp: Breakpoint,
): T | undefined {
  if (typeof value !== "object" || value === null) return value;
  const byBp = value as { [K in Breakpoint]?: T };
  for (let i = ORDER.indexOf(bp); i >= 0; i--) {
    const picked = byBp[ORDER[i] as Breakpoint];
    if (picked !== undefined) return picked;
  }
  return undefined;
}

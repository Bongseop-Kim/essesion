/** 개발 빌드에서만 경고 — 프로덕션은 no-op(번들에서 제거). */
export function warnDev(condition: boolean, message: string): void {
  if (process.env.NODE_ENV !== "production" && condition) {
    console.warn(message);
  }
}

/** 배열이 아닌 순수 객체인지. JSON 파싱 결과 검증에 쓴다. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** `location.state`처럼 unknown인 값이 특정 키를 가진 객체인지 좁힌다. */
export function hasStateKey<K extends string>(
  state: unknown,
  key: K,
): state is Record<K, unknown> {
  return typeof state === "object" && state !== null && key in state;
}

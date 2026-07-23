import type { Ref } from "react";

/** 단일 ref(콜백/객체)에 값 대입 — null 안전. */
export function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

/** 여러 ref를 하나의 콜백 ref로 합친다(호출마다 새 identity — 안정적 identity가 필요하면 useCallback으로 감쌀 것). */
export function mergeRefs<T>(
  ...refs: (Ref<T> | undefined)[]
): (value: T | null) => void {
  return (value) => {
    for (const ref of refs) assignRef(ref, value);
  };
}

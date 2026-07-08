import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

import { textSteps } from "./tokens";

/* 커스텀 t-스케일을 font-size 그룹으로 등록 — 미등록 시 twMerge가
   text-t3(크기)와 text-fg-contrast(색)를 같은 그룹으로 보고 앞 클래스를 제거한다. */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...textSteps] }],
    },
  },
});

/** Tailwind 클래스 조건부 결합 + 충돌 병합 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

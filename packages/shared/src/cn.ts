import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind 클래스 조건부 결합 + 충돌 병합 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

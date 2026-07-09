import type { ComponentPropsWithRef } from "react";

import { cn } from "../cn";
import { ProgressCircle } from "./progress-circle";

const variants = {
  brandSolid:
    "bg-bg-brand-solid text-fg-contrast hover:bg-bg-brand-solid-hover active:bg-bg-brand-solid-pressed",
  neutralWeak:
    "bg-bg-neutral-weak text-fg-neutral hover:bg-bg-neutral-weak-hover active:bg-bg-neutral-weak-pressed",
  criticalSolid:
    "bg-bg-critical-solid text-fg-contrast hover:bg-bg-critical-solid-hover active:bg-bg-critical-solid-pressed",
  neutralOutline:
    "border border-stroke-neutral bg-bg-layer-default text-fg-neutral hover:bg-bg-neutral-weak active:bg-bg-neutral-weak-pressed",
  ghost:
    "text-fg-neutral-muted hover:bg-bg-neutral-weak active:bg-bg-neutral-weak-pressed",
  // 소셜 로그인 전용 브랜드 버튼 (모노크롬 예외 — theme.css brand-login 토큰)
  kakao:
    "bg-bg-kakao text-fg-neutral hover:bg-bg-kakao-hover active:bg-bg-kakao-pressed",
  naver:
    "bg-bg-naver text-fg-contrast hover:bg-bg-naver-hover active:bg-bg-naver-pressed",
};

const sizes = {
  xsmall: "h-8 px-x3 text-t3 rounded-full",
  small: "h-9 px-x3_5 text-t4 rounded-r2",
  medium: "h-10 px-x4 text-t4 rounded-r2",
  large: "h-13 px-x5 text-t5 rounded-r3",
};

const iconOnlySizes = {
  xsmall: "w-8 px-0",
  small: "w-9 px-0",
  medium: "w-10 px-0",
  large: "w-13 px-0",
};

const spinnerSizes = { xsmall: 16, small: 16, medium: 16, large: 24 } as const;

export type ActionButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  /** 로딩 중 — 라벨을 스피너로 교체하고 비활성화 */
  loading?: boolean;
  /** 아이콘 단독 버튼(정사각) — aria-label 필수 */
  iconOnly?: boolean;
};

export function ActionButton({
  variant = "brandSolid",
  size = "medium",
  loading = false,
  iconOnly = false,
  className,
  type = "button",
  disabled,
  children,
  ...props
}: ActionButtonProps) {
  if (
    process.env.NODE_ENV !== "production" &&
    iconOnly &&
    !props["aria-label"]
  ) {
    console.warn("ActionButton: iconOnly 버튼에는 aria-label이 필요합니다.");
  }
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-bold transition-colors duration-100 ease-standard",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        iconOnly && iconOnlySizes[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <ProgressCircle
          size={spinnerSizes[size]}
          tone="contrast"
          className="text-current"
        />
      ) : (
        children
      )}
    </button>
  );
}

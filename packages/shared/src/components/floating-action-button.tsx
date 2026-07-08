import type { ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "../cn";

export type FloatingActionButtonProps = ComponentPropsWithRef<"button"> & {
  /** 라벨을 아이콘 옆에 노출하는 확장형(pill) FAB */
  extended?: boolean;
  icon: ReactNode;
  /** extended일 때만 라벨로 렌더 */
  children?: ReactNode;
};

export function FloatingActionButton({
  extended = false,
  icon,
  children,
  className,
  type = "button",
  disabled,
  ...props
}: FloatingActionButtonProps) {
  if (
    process.env.NODE_ENV !== "production" &&
    !extended &&
    !props["aria-label"]
  ) {
    console.warn(
      "FloatingActionButton: 아이콘 단독 FAB에는 aria-label이 필요합니다.",
    );
  }
  return (
    // 화면 고정 배치(fixed/bottom/right 등)는 소비자가 래퍼에서 결정한다.
    <button
      type={type}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center transition-colors duration-100 ease-standard",
        "bg-bg-brand-solid text-fg-contrast shadow-s3 hover:bg-bg-brand-solid-hover active:bg-bg-brand-solid-pressed",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        extended
          ? "h-12 gap-x2 rounded-full px-x4_5 text-t5 font-bold"
          : "size-14 rounded-full",
        className,
      )}
      {...props}
    >
      {/* 아이콘 크기는 소비자가 결정(예: <PlusIcon className="size-6" />) */}
      <span className="flex items-center justify-center">{icon}</span>
      {extended && children}
    </button>
  );
}

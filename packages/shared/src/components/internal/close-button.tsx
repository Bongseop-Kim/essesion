import type { ComponentPropsWithRef } from "react";

import { cn } from "../../cn";
import { XGlyph } from "./glyphs";

export type CloseButtonProps = ComponentPropsWithRef<"button"> & {
  label?: string;
};

/** 오버레이 공용 원형 닫기 버튼 (BottomSheet·SidePanel·Callout·PageBanner 등) */
export function CloseButton({
  label = "닫기",
  className,
  ...props
}: CloseButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full bg-bg-neutral-weak text-fg-neutral-muted transition-colors duration-100 ease-standard",
        "hover:bg-bg-neutral-weak-hover active:bg-bg-neutral-weak-pressed",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring",
        className,
      )}
      {...props}
    >
      <XGlyph className="size-3.5" />
    </button>
  );
}

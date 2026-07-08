import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../cn";

const variants = {
  primary:
    "bg-bg-brand-solid text-fg-contrast hover:bg-bg-brand-solid-hover active:bg-bg-brand-solid-pressed",
  secondary:
    "border border-stroke-neutral bg-bg-layer-default text-fg-neutral hover:bg-bg-neutral-weak active:bg-bg-neutral-weak-pressed",
  ghost:
    "text-fg-neutral-muted hover:bg-bg-neutral-weak active:bg-bg-neutral-weak-pressed",
  danger:
    "bg-bg-critical-solid text-fg-contrast hover:bg-bg-critical-solid-hover active:bg-bg-critical-solid-pressed",
};

const sizes = {
  sm: "h-8 px-3 text-t3",
  md: "h-10 px-4 text-t4",
  lg: "h-12 px-6 text-t5",
};

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-r2 font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

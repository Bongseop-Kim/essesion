import type { ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "../cn";
import { focusRing } from "./internal/focus-ring";
import { useControllableState } from "./internal/use-controllable-state";

const sizes = {
  small: "h-8 px-x3",
  medium: "h-9 px-x3_5",
  large: "h-10 px-x4",
};

const variants = {
  solid: "bg-bg-neutral-weak text-fg-neutral hover:bg-bg-neutral-weak-hover",
  outline:
    "border border-stroke-neutral text-fg-neutral hover:bg-bg-neutral-weak",
};

const selectedVariants = {
  solid: "bg-bg-brand-solid text-fg-contrast hover:bg-bg-brand-solid-hover",
  outline: "border border-stroke-brand bg-bg-brand-weak text-fg-neutral",
};

export type ChipProps = Omit<ComponentPropsWithRef<"button">, "prefix"> & {
  selected?: boolean;
  defaultSelected?: boolean;
  onSelectedChange?: (value: boolean) => void;
  size?: keyof typeof sizes;
  variant?: keyof typeof variants;
  /** 라벨 앞 슬롯 — 아이콘·글리프 등 */
  prefix?: ReactNode;
};

export function Chip({
  selected,
  defaultSelected = false,
  onSelectedChange,
  size = "medium",
  variant = "solid",
  prefix,
  className,
  disabled,
  onClick,
  children,
  ...props
}: ChipProps) {
  const [isSelected, setSelected] = useControllableState({
    value: selected,
    defaultValue: defaultSelected,
    onChange: onSelectedChange,
  });
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      disabled={disabled}
      onClick={(event) => {
        setSelected(!isSelected);
        onClick?.(event);
      }}
      className={cn(
        "inline-flex items-center gap-x1 rounded-full text-t4 font-medium transition-colors duration-(--duration-fast) ease-standard",
        focusRing,
        "disabled:pointer-events-none disabled:opacity-50",
        sizes[size],
        isSelected ? selectedVariants[variant] : variants[variant],
        className,
      )}
      {...props}
    >
      {prefix}
      {children}
    </button>
  );
}

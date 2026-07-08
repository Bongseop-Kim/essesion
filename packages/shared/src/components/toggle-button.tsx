import type { ComponentPropsWithRef } from "react";

import { cn } from "../cn";
import { useControllableState } from "./internal/use-controllable-state";

// seed 반전 규칙: 눌림 상태는 미눌림의 역상(brandSolid ↔ neutralWeak).
const variants = {
  brandSolid:
    "bg-bg-brand-solid text-fg-contrast hover:bg-bg-brand-solid-hover",
  neutralWeak:
    "bg-bg-neutral-weak text-fg-neutral hover:bg-bg-neutral-weak-hover",
};

const pressedVariants = {
  brandSolid:
    "bg-bg-neutral-weak text-fg-neutral hover:bg-bg-neutral-weak-hover",
  neutralWeak:
    "bg-bg-brand-solid text-fg-contrast hover:bg-bg-brand-solid-hover",
};

const sizes = {
  xsmall: "h-8 px-x3 text-t3",
  small: "h-9 px-x3_5 text-t4",
};

export type ToggleButtonProps = ComponentPropsWithRef<"button"> & {
  pressed?: boolean;
  defaultPressed?: boolean;
  onPressedChange?: (value: boolean) => void;
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
};

export function ToggleButton({
  pressed,
  defaultPressed = false,
  onPressedChange,
  variant = "brandSolid",
  size = "small",
  className,
  disabled,
  onClick,
  ...props
}: ToggleButtonProps) {
  const [isPressed, setPressed] = useControllableState({
    value: pressed,
    defaultValue: defaultPressed,
    onChange: onPressedChange,
  });
  return (
    <button
      type="button"
      aria-pressed={isPressed}
      disabled={disabled}
      onClick={(event) => {
        setPressed(!isPressed);
        onClick?.(event);
      }}
      className={cn(
        "inline-flex items-center justify-center gap-x1 rounded-full font-bold transition-colors duration-(--duration-fast) ease-standard",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        sizes[size],
        isPressed ? pressedVariants[variant] : variants[variant],
        className,
      )}
      {...props}
    />
  );
}

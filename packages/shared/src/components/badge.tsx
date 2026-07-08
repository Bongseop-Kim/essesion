import type { ComponentPropsWithRef } from "react";

import { cn } from "../cn";

type Tone =
  | "neutral"
  | "brand"
  | "critical"
  | "positive"
  | "warning"
  | "informative";

const toneVariants: Record<
  "weak" | "solid" | "outline",
  Record<Tone, string>
> = {
  weak: {
    neutral: "bg-bg-neutral-weak text-fg-neutral-muted",
    brand: "bg-bg-brand-weak text-fg-brand",
    critical: "bg-bg-critical-weak text-fg-critical",
    positive: "bg-bg-positive-weak text-fg-positive",
    warning: "bg-bg-warning-weak text-fg-warning",
    informative: "bg-bg-informative-weak text-fg-informative",
  },
  solid: {
    neutral: "bg-bg-neutral-solid text-fg-contrast",
    brand: "bg-bg-brand-solid text-fg-contrast",
    critical: "bg-bg-critical-solid text-fg-contrast",
    positive: "bg-bg-positive-solid text-fg-contrast",
    // warning은 solid 없음(노랑+흰글자 APCA 미달) → weak로 폴백. color-role.md 참조.
    warning: "bg-bg-warning-weak text-fg-warning",
    informative: "bg-bg-informative-solid text-fg-contrast",
  },
  outline: {
    neutral: "border border-stroke-neutral text-fg-neutral-muted",
    brand: "border border-stroke-brand text-fg-brand",
    critical: "border border-stroke-critical text-fg-critical",
    positive: "border border-stroke-positive text-fg-positive",
    warning: "border border-stroke-warning text-fg-warning",
    informative: "border border-stroke-informative text-fg-informative",
  },
};

const sizes = {
  medium: "min-h-5 px-x1_5 rounded-r1 text-t1 font-medium",
  large: "min-h-6 px-x2 rounded-r1_5 text-t2 font-medium",
};

export type BadgeProps = ComponentPropsWithRef<"span"> & {
  variant?: keyof typeof toneVariants;
  tone?: Tone;
  size?: keyof typeof sizes;
};

export function Badge({
  variant = "weak",
  tone = "neutral",
  size = "medium",
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center",
        sizes[size],
        toneVariants[variant][tone],
        className,
      )}
      {...props}
    />
  );
}

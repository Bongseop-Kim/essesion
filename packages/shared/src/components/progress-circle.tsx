import type { ComponentPropsWithRef } from "react";

import { cn } from "../cn";

const tones = {
  neutral: "text-fg-neutral-subtle",
  brand: "text-fg-brand",
  contrast: "text-fg-contrast",
};

const strokeWidths = { 16: 2, 24: 3, 40: 5 } as const;

export type ProgressCircleProps = Omit<
  ComponentPropsWithRef<"svg">,
  "children"
> & {
  /** 0~1. 생략하면 indeterminate(회전) */
  value?: number;
  size?: 16 | 24 | 40;
  tone?: keyof typeof tones;
};

export function ProgressCircle({
  value,
  size = 24,
  tone = "neutral",
  className,
  ...props
}: ProgressCircleProps) {
  const strokeWidth = strokeWidths[size];
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const indeterminate = value === undefined;
  const dashOffset = indeterminate
    ? circumference * 0.25
    : circumference * (1 - Math.min(1, Math.max(0, value)));

  return (
    <svg
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={indeterminate ? undefined : value}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn(tones[tone], indeterminate && "animate-spin", className)}
      {...props}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        opacity={0.25}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

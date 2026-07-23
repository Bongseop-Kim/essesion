import type { ComponentPropsWithRef } from "react";

import { cn } from "../cn";

const tones = {
  neutral: "text-fg-neutral-subtle",
  contrast: "text-fg-contrast",
};

const strokeWidths = { 16: 2, 24: 3, 40: 5 } as const;

export type ProgressCircleProps = Omit<
  ComponentPropsWithRef<"svg">,
  "children"
> & {
  size?: 16 | 24 | 40;
  tone?: keyof typeof tones;
};

/** 형태 없는 대기 표시 — 항상 회전하는 indeterminate 스피너. */
export function ProgressCircle({
  size = 24,
  tone = "neutral",
  className,
  ...props
}: ProgressCircleProps) {
  const strokeWidth = strokeWidths[size];
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={1}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn(tones[tone], "animate-spin", className)}
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
        strokeDashoffset={circumference * 0.25}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

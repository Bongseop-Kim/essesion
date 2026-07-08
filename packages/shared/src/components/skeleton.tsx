import type { ComponentPropsWithRef } from "react";

import { cn } from "../cn";

const radii = {
  r2: "rounded-r2",
  r4: "rounded-r4",
  full: "rounded-full",
  0: "",
} as const;

export type SkeletonProps = Omit<ComponentPropsWithRef<"div">, "children"> & {
  width?: number | string;
  height?: number | string;
  radius?: keyof typeof radii;
};

export function Skeleton({
  width,
  height,
  radius = "r2",
  className,
  style,
  ...props
}: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative overflow-hidden bg-bg-neutral-weak",
        radii[radius],
        className,
      )}
      style={{ width, height, ...style }}
      {...props}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 animate-shimmer bg-linear-to-r from-transparent via-white/60 to-transparent"
      />
    </div>
  );
}

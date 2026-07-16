import type { ComponentPropsWithRef } from "react";

import { cn } from "../cn";
import { resolveSize, type TokenSize } from "../style-props";

const radii = {
  r2: "rounded-r2",
  r4: "rounded-r4",
  full: "rounded-full",
  0: "",
} as const;

const presets = {
  title: { width: "60%", height: "x6" },
  line: { width: "full", height: "x5" },
  "line-medium": { width: "80%", height: "x5" },
  media: { width: "full", height: "size.loading-media" },
  result: { width: "full", height: "size.loading-result" },
} satisfies Record<string, { width: TokenSize; height: TokenSize }>;

export type SkeletonPreset = keyof typeof presets;

export type SkeletonProps = Omit<ComponentPropsWithRef<"div">, "children"> & {
  width?: TokenSize;
  height?: TokenSize;
  radius?: keyof typeof radii;
  preset?: SkeletonPreset;
};

export function Skeleton({
  width,
  height,
  radius = "r2",
  preset,
  className,
  style,
  ...props
}: SkeletonProps) {
  const dimensions = preset === undefined ? undefined : presets[preset];
  const resolvedWidth = width ?? dimensions?.width;
  const resolvedHeight = height ?? dimensions?.height;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative overflow-hidden bg-bg-neutral-weak",
        radii[radius],
        className,
      )}
      style={{
        width:
          resolvedWidth === undefined ? undefined : resolveSize(resolvedWidth),
        height:
          resolvedHeight === undefined
            ? undefined
            : resolveSize(resolvedHeight),
        ...style,
      }}
      {...props}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 animate-shimmer bg-linear-to-r from-transparent via-bg-shimmer-highlight to-transparent"
      />
    </div>
  );
}

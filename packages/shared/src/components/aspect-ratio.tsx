import type { ComponentPropsWithRef } from "react";

import { cn } from "../cn";

export type AspectRatioProps = ComponentPropsWithRef<"div"> & {
  /** 폭/높이 비율 (기본 4/3). 미디어 자식은 absolute inset-0 또는 size-full 권장 */
  ratio?: number;
};

export function AspectRatio({
  ratio = 4 / 3,
  className,
  style,
  ...props
}: AspectRatioProps) {
  return (
    <div
      className={cn("relative overflow-hidden", className)}
      style={{ aspectRatio: ratio, ...style }}
      {...props}
    />
  );
}

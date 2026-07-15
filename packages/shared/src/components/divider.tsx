import type { ComponentPropsWithRef } from "react";

import { cn } from "../cn";

export type DividerProps = ComponentPropsWithRef<"hr"> & {
  /** 좌우 여백 */
  inset?: boolean;
};

export function Divider({ inset = false, className, ...props }: DividerProps) {
  return (
    <hr
      className={cn(
        "h-px w-full border-0 bg-stroke-neutral-weak",
        inset && "mx-x4",
        className,
      )}
      {...props}
    />
  );
}

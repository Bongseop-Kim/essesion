import type { ComponentPropsWithRef, ElementType } from "react";

import { cn } from "../cn";

export type DividerProps = ComponentPropsWithRef<"hr"> & {
  as?: "hr" | "div" | "li";
  orientation?: "horizontal" | "vertical";
  /** 가로는 좌우, 세로는 상하 여백 */
  inset?: boolean;
};

export function Divider({
  as = "hr",
  orientation = "horizontal",
  inset = false,
  className,
  ...props
}: DividerProps) {
  const Comp = as as ElementType;
  const vertical = orientation === "vertical";
  return (
    <Comp
      {...(as !== "hr" && {
        role: "separator",
        "aria-orientation": vertical ? "vertical" : undefined,
      })}
      className={cn(
        vertical
          ? "w-px self-stretch border-0 bg-stroke-neutral-weak"
          : "h-px w-full border-0 bg-stroke-neutral-weak",
        inset && (vertical ? "my-x2" : "mx-x4"),
        className,
      )}
      {...props}
    />
  );
}

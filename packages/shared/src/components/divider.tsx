import type { ComponentPropsWithRef } from "react";

import { cn } from "../cn";

export type DividerProps = ComponentPropsWithRef<"hr">;

export function Divider({ className, ...props }: DividerProps) {
  return (
    <hr
      className={cn("h-px w-full border-0 bg-stroke-neutral-weak", className)}
      {...props}
    />
  );
}

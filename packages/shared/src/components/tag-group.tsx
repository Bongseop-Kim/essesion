import { Children, type ComponentPropsWithRef, type ReactNode } from "react";

import { cn } from "../cn";

export type TagGroupProps = ComponentPropsWithRef<"span">;

export function TagGroup({ className, children, ...props }: TagGroupProps) {
  const items = Children.toArray(children);
  const rendered: ReactNode[] = [];
  items.forEach((child, i) => {
    if (i > 0) {
      rendered.push(
        <span
          key={`separator-${i}`}
          aria-hidden="true"
          className="text-fg-neutral-subtle"
        >
          ·
        </span>,
      );
    }
    rendered.push(child);
  });

  return (
    <span
      className={cn("inline-flex flex-wrap items-center gap-x1", className)}
      {...props}
    >
      {rendered}
    </span>
  );
}

export type TagProps = ComponentPropsWithRef<"span">;

export function Tag({ className, children, ...props }: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center text-t3 text-fg-neutral-subtle",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

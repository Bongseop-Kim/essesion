import { Children, type ComponentPropsWithRef, type ReactNode } from "react";

import { cn } from "../cn";

export type TagGroupProps = ComponentPropsWithRef<"span"> & {
  /** 태그 사이 구분자 */
  separator?: ReactNode;
};

export function TagGroup({
  separator = "·",
  className,
  children,
  ...props
}: TagGroupProps) {
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
          {separator}
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

const tagSizes = {
  t2: "text-t2",
  t3: "text-t3",
  t4: "text-t4",
};

const tagTones = {
  "neutral-subtle": "text-fg-neutral-subtle",
  neutral: "text-fg-neutral",
  brand: "text-fg-brand",
};

export type TagProps = ComponentPropsWithRef<"span"> & {
  size?: keyof typeof tagSizes;
  tone?: keyof typeof tagTones;
  icon?: ReactNode;
};

export function Tag({
  size = "t3",
  tone = "neutral-subtle",
  icon,
  className,
  children,
  ...props
}: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-x0_5",
        tagSizes[size],
        tagTones[tone],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}

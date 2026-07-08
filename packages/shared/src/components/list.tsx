import type {
  ComponentPropsWithRef,
  MouseEventHandler,
  ReactNode,
} from "react";

import { cn } from "../cn";

export type ListProps = ComponentPropsWithRef<"ul">;

/** 세로 목록 컨테이너 — li 마커 제거는 preflight가 담당. */
export function List({ className, ...props }: ListProps) {
  return <ul className={cn("flex flex-col", className)} {...props} />;
}

const rowBase =
  "flex w-full items-center gap-x3 px-x4 py-x3 text-left rounded-r2 transition-colors duration-100 ease-standard";
const rowInteractive =
  "hover:bg-bg-neutral-weak active:bg-bg-neutral-weak-pressed focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-stroke-focus-ring";

export type ListItemProps = {
  title: ReactNode;
  description?: ReactNode;
  prefix?: ReactNode;
  suffix?: ReactNode;
  href?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  disabled?: boolean;
} & Omit<ComponentPropsWithRef<"li">, "title" | "prefix" | "onClick">;

/** 목록 행 — href→a, onClick→button, 그 외 div. 내부는 prefix·본문·suffix. */
export function ListItem({
  title,
  description,
  prefix,
  suffix,
  href,
  onClick,
  disabled = false,
  className,
  ...props
}: ListItemProps) {
  const interactive =
    !disabled && (href !== undefined || onClick !== undefined);
  const rowClass = cn(
    rowBase,
    interactive && rowInteractive,
    disabled && "pointer-events-none opacity-50",
  );

  const body = (
    <>
      {prefix !== undefined && (
        <span className="shrink-0 text-fg-neutral-muted">{prefix}</span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-t5 text-fg-neutral">{title}</span>
        {description !== undefined && (
          <span className="text-t3 text-fg-neutral-subtle">{description}</span>
        )}
      </span>
      {suffix !== undefined && (
        <span className="shrink-0 text-t5 text-fg-neutral-subtle">
          {suffix}
        </span>
      )}
    </>
  );

  let row: ReactNode;
  if (interactive && href !== undefined) {
    row = (
      <a href={href} onClick={onClick} className={rowClass}>
        {body}
      </a>
    );
  } else if (interactive) {
    row = (
      <button type="button" onClick={onClick} className={rowClass}>
        {body}
      </button>
    );
  } else {
    row = <div className={rowClass}>{body}</div>;
  }

  return (
    <li className={className} {...props}>
      {row}
    </li>
  );
}

const headerVariants = {
  mediumWeak: "font-medium text-fg-neutral-subtle",
  boldSolid: "font-bold text-fg-neutral",
};

export type ListHeaderProps = {
  variant?: keyof typeof headerVariants;
} & ComponentPropsWithRef<"div">;

/** 목록 구간 제목 — mediumWeak(기본)·boldSolid. */
export function ListHeader({
  variant = "mediumWeak",
  className,
  ...props
}: ListHeaderProps) {
  return (
    <div
      className={cn("px-x4 py-x2 text-t4", headerVariants[variant], className)}
      {...props}
    />
  );
}

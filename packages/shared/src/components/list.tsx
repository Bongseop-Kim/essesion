import type {
  ComponentPropsWithRef,
  MouseEventHandler,
  ReactNode,
} from "react";

import { cn } from "../cn";
import { Flex } from "./flex";
import { VStack } from "./stack";
import { Text } from "./text";

export type ListProps = ComponentPropsWithRef<"ul">;

/** 세로 목록 컨테이너 — li 마커 제거는 preflight가 담당. */
export function List({ className, ...props }: ListProps) {
  return <Flex as="ul" direction="column" className={className} {...props} />;
}

const rowBase =
  "w-full text-left rounded-r2 transition-colors duration-100 ease-standard";
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
        <Text as="span" color="fg.neutral-muted" className="shrink-0">
          {prefix}
        </Text>
      )}
      <VStack as="span" minWidth={0} flex={1}>
        <Text as="span" textStyle="body" color="fg.neutral">
          {title}
        </Text>
        {description !== undefined && (
          <Text as="span" textStyle="caption" color="fg.neutral-subtle">
            {description}
          </Text>
        )}
      </VStack>
      {suffix !== undefined && (
        <Text
          as="span"
          textStyle="body"
          color="fg.neutral-subtle"
          className="shrink-0"
        >
          {suffix}
        </Text>
      )}
    </>
  );

  let row: ReactNode;
  if (interactive && href !== undefined) {
    row = (
      <Flex
        as="a"
        href={href}
        onClick={onClick}
        align="center"
        gap="x3"
        px="x4"
        py="x3"
        className={rowClass}
      >
        {body}
      </Flex>
    );
  } else if (interactive) {
    row = (
      <Flex
        as="button"
        type="button"
        onClick={onClick}
        align="center"
        gap="x3"
        px="x4"
        py="x3"
        className={rowClass}
      >
        {body}
      </Flex>
    );
  } else {
    row = (
      <Flex align="center" gap="x3" px="x4" py="x3" className={rowClass}>
        {body}
      </Flex>
    );
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
    <Text
      as="div"
      px="x4"
      py="x2"
      textStyle="bodySm"
      className={cn(headerVariants[variant], className)}
      {...props}
    />
  );
}

import type { MouseEventHandler, ReactNode } from "react";

import { cn } from "../cn";
import { focusRing } from "./internal/focus-ring";
import { ChevronRightGlyph } from "./internal/glyphs";
import { HStack } from "./stack";
import { Text } from "./text";

export type BreadcrumbItem = { href?: string; label: string; key?: string };

export type BreadcrumbLinkProps = {
  className: string;
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
};

export type BreadcrumbProps = {
  /** 경로 항목. 마지막 = 현재 페이지(보통 href 없음 → 링크 아님). */
  items: BreadcrumbItem[];
  /** href 있는 항목 렌더 — Header.renderLink와 동일 계약(라우터 비의존). */
  renderLink: (item: BreadcrumbItem, props: BreadcrumbLinkProps) => ReactNode;
};

const linkClass = cn(
  "rounded-r1 text-t3 text-fg-neutral-muted",
  "transition-colors duration-(--duration-fast) ease-standard hover:text-fg-neutral",
  focusRing,
);

/** 페이지 경로 표시 — store·admin 공용. 라우팅은 앱이 renderLink로 연결. */
export function Breadcrumb({ items, renderLink }: BreadcrumbProps) {
  return (
    <HStack as="nav" aria-label="탐색 경로" gap="x1" py="x3">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const linkable = item.href !== undefined && !isLast;
        return (
          <HStack as="span" key={item.key ?? item.href ?? item.label} gap="x1">
            {index > 0 ? (
              <ChevronRightGlyph
                width={12}
                height={12}
                className="shrink-0 text-fg-neutral-muted"
              />
            ) : null}
            {linkable ? (
              renderLink(item, { className: linkClass, children: item.label })
            ) : (
              <Text
                textStyle="caption"
                color={isLast ? "fg.neutral" : "fg.neutral-muted"}
                aria-current={isLast ? "page" : undefined}
              >
                {item.label}
              </Text>
            )}
          </HStack>
        );
      })}
    </HStack>
  );
}

import type { AnchorHTMLAttributes, ReactElement, ReactNode } from "react";

import { cn } from "../cn";
import { Box, type BoxProps } from "./box";
import { focusRing } from "./internal/focus-ring";
import { LayoutContent } from "./layout";
import { VStack } from "./stack";
import { Text } from "./text";

/** 스토어 푸터 — basement 배경 + 상단 구분선. 내부는 LayoutContent(medium) 폭. */
export function Footer({ children, className, ...props }: BoxProps) {
  return (
    <Box
      as="footer"
      bg="bg.layer-basement"
      py="x10"
      className={cn("border-t border-stroke-neutral-weak", className)}
      {...props}
    >
      <LayoutContent flexGrow={0}>{children}</LayoutContent>
    </Box>
  );
}

export type FooterSectionProps = {
  title?: ReactNode;
  children: ReactNode;
};

export function FooterSection({ title, children }: FooterSectionProps) {
  return (
    <VStack gap="x3" alignItems="start">
      {title != null && <Text textStyle="labelSm">{title}</Text>}
      {children}
    </VStack>
  );
}

export type FooterLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  renderLink?: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => ReactElement;
};

export function FooterLink({
  className,
  renderLink,
  ...props
}: FooterLinkProps) {
  const linkProps = {
    className: cn(
      "text-t4 font-medium text-fg-neutral-muted transition-colors duration-(--duration-fast) ease-standard hover:text-fg-neutral",
      focusRing,
      className,
    ),
    ...props,
  };
  return renderLink ? renderLink(linkProps) : <a {...linkProps} />;
}

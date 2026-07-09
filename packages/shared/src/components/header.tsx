import type { MouseEventHandler, ReactNode } from "react";
import { useState } from "react";

import { cn } from "../cn";
import { ActionButton } from "./action-button";
import { Box } from "./box";
import { SidePanel } from "./side-panel";
import { HStack, VStack } from "./stack";
import { Text } from "./text";

export type HeaderNavItem = {
  href: string;
  label: string;
  key?: string;
};

export type HeaderLinkProps = {
  className: string;
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  "aria-current"?: "page";
  "aria-label"?: string;
};

export type HeaderProps = {
  brandLabel: string;
  brandHref: string;
  brandLogoSrc?: string;
  navItems: HeaderNavItem[];
  activePathname: string;
  renderLink: (item: HeaderNavItem, props: HeaderLinkProps) => ReactNode;
  menuIcon: ReactNode;
  actions?: ReactNode;
  mobileActions?: ReactNode;
  mobileMenuFooter?: ReactNode;
};

function isActivePath(pathname: string, href: string) {
  return href === "/" ? pathname === href : pathname.startsWith(href);
}

export function Header({
  brandLabel,
  brandHref,
  brandLogoSrc,
  navItems,
  activePathname,
  renderLink,
  menuIcon,
  actions,
  mobileActions,
  mobileMenuFooter,
}: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const brandItem = { href: brandHref, label: brandLabel, key: "brand" };

  return (
    <>
      <Box
        as="header"
        position="sticky"
        top={0}
        zIndex={30}
        bg="bg.layer-default"
        className="border-b border-stroke-neutral-weak"
      >
        <HStack
          as="nav"
          aria-label="주요 메뉴"
          justify="space-between"
          gap="x3"
          minHeight={{ base: 56, md: 64 }}
          px={{ base: "x4", md: "x6" }}
        >
          <HStack gap={{ base: "x2", md: "x5" }} minWidth={0}>
            {renderLink(brandItem, {
              className: cn(
                "inline-flex min-h-10 shrink-0 items-center gap-x2 rounded-r2",
                "text-fg-neutral transition-colors duration-100 ease-standard",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring",
              ),
              "aria-label": brandLabel,
              children: (
                <HStack gap="x2">
                  {brandLogoSrc ? (
                    <Box
                      as="img"
                      src={brandLogoSrc}
                      alt=""
                      width={{ base: 32, md: 40 }}
                      height={{ base: 32, md: 40 }}
                      borderRadius="r1"
                      className="shrink-0"
                    />
                  ) : (
                    <Text as="span" textStyle="label" color="fg.neutral">
                      {brandLabel}
                    </Text>
                  )}
                </HStack>
              ),
            })}

            <HStack
              as="div"
              display={{ base: "none", md: "flex" }}
              gap="x1"
              overflowX="auto"
              minWidth={0}
            >
              {navItems.map((item) => {
                const active = isActivePath(activePathname, item.href);
                return renderLink(item, {
                  className: cn(
                    "inline-flex h-10 shrink-0 items-center rounded-r2 px-x2 text-t4 font-medium",
                    "transition-colors duration-100 ease-standard",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring",
                    active
                      ? "bg-bg-neutral-weak text-fg-neutral"
                      : "text-fg-neutral-muted hover:bg-bg-neutral-weak hover:text-fg-neutral active:bg-bg-neutral-weak-pressed",
                  ),
                  "aria-current": active ? "page" : undefined,
                  children: item.label,
                });
              })}
            </HStack>
          </HStack>

          <HStack gap="x1_5" flexShrink={0}>
            <HStack display={{ base: "none", md: "flex" }} gap="x1_5">
              {actions}
            </HStack>
            <HStack display={{ base: "flex", md: "none" }} gap="x1">
              {mobileActions}
              <ActionButton
                type="button"
                variant="ghost"
                size="medium"
                iconOnly
                aria-label="메뉴 열기"
                onClick={() => setMenuOpen(true)}
              >
                {menuIcon}
              </ActionButton>
            </HStack>
          </HStack>
        </HStack>
      </Box>

      <SidePanel
        open={menuOpen}
        onOpenChange={setMenuOpen}
        title="메뉴"
        side="right"
        footer={mobileMenuFooter}
      >
        <VStack gap="x1">
          {navItems.map((item) => {
            const active = isActivePath(activePathname, item.href);
            return renderLink(item, {
              className: cn(
                "flex min-h-13 w-full items-center rounded-r2 px-x3 text-t5 font-medium",
                "transition-colors duration-100 ease-standard",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring",
                active
                  ? "bg-bg-neutral-weak text-fg-neutral"
                  : "text-fg-neutral-muted hover:bg-bg-neutral-weak hover:text-fg-neutral active:bg-bg-neutral-weak-pressed",
              ),
              "aria-current": active ? "page" : undefined,
              onClick: () => setMenuOpen(false),
              children: item.label,
            });
          })}
        </VStack>
      </SidePanel>
    </>
  );
}

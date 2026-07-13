import type { MouseEventHandler, ReactNode } from "react";
import { useState } from "react";

import { cn } from "../cn";
import { ActionButton } from "./action-button";
import { Box } from "./box";
import { LayoutContent, type LayoutContentProps } from "./layout";
import { ScrollFog } from "./scroll-fog";
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
  mobileMenuFooter?: ReactNode | ((closeMenu: () => void) => ReactNode);
  /** 내부 nav 최대폭 — 콘텐츠·푸터와 정렬. 기본 high(제한 없음, admin 대시보드용). store는 medium. */
  density?: LayoutContentProps["density"];
  /** 데스크톱 주요 메뉴 표시 여부. admin처럼 별도 sidebar가 있는 앱만 끈다. */
  showDesktopNavigation?: boolean;
};

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
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
  density = "high",
  showDesktopNavigation = true,
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
        <LayoutContent density={density} flexGrow={0}>
          <HStack
            as="nav"
            aria-label="주요 메뉴"
            justify="space-between"
            gap="x3"
            minHeight={{ base: 56, md: 64 }}
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

              {showDesktopNavigation && (
                <Box display={{ base: "none", md: "block" }} minWidth={0}>
                  <ScrollFog direction="horizontal">
                    <HStack as="div" gap="x1" minWidth={0}>
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
                  </ScrollFog>
                </Box>
              )}
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
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen(true)}
                >
                  {menuIcon}
                </ActionButton>
              </HStack>
            </HStack>
          </HStack>
        </LayoutContent>
      </Box>

      <SidePanel
        open={menuOpen}
        onOpenChange={setMenuOpen}
        title="메뉴"
        side="right"
        footer={
          typeof mobileMenuFooter === "function"
            ? mobileMenuFooter(() => setMenuOpen(false))
            : mobileMenuFooter
        }
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

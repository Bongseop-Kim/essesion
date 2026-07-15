import { Box, cn, Divider, Text, VStack } from "@essesion/shared";
import { Fragment } from "react";
import { Link, useLocation } from "react-router";

import {
  ADMIN_NAVIGATION_GROUPS,
  isAdminNavigationActive,
} from "../../shared/config/navigation";

export function AdminSidebar() {
  const { pathname } = useLocation();

  return (
    <Box
      as="nav"
      aria-label="관리자 메뉴"
      display={{ base: "none", md: "block" }}
      width={240}
      flexShrink={0}
      bg="bg.layer-default"
      className="border-r border-stroke-neutral-weak"
    >
      <VStack gap="x2" p="x4" alignItems="stretch">
        {ADMIN_NAVIGATION_GROUPS.map((group, index) => {
          return (
            <Fragment key={group.key}>
              {index === 0 ? null : (
                <Box px="x3">
                  <Divider />
                </Box>
              )}
              <VStack
                as={group.label === null ? "div" : "section"}
                gap="x1"
                alignItems="stretch"
                aria-label={group.label ?? undefined}
              >
                {group.items.map((item) => {
                  const active = isAdminNavigationActive(pathname, item.href);
                  return (
                    <Link
                      key={item.key}
                      to={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-10 items-center rounded-r2 px-x3",
                        "transition-colors duration-100 ease-standard",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring",
                        active
                          ? "bg-bg-neutral-weak text-fg-neutral"
                          : "text-fg-neutral-muted hover:bg-bg-neutral-weak hover:text-fg-neutral active:bg-bg-neutral-weak-pressed",
                      )}
                    >
                      <Text as="span" textStyle="labelSm" color="currentColor">
                        {item.label}
                      </Text>
                    </Link>
                  );
                })}
              </VStack>
            </Fragment>
          );
        })}
      </VStack>
    </Box>
  );
}

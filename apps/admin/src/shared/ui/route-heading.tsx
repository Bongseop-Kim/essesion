import { Flex, HStack, Icon, Text, VStack } from "@essesion/shared";
import { ChevronLeftIcon } from "@heroicons/react/20/solid";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { Link, useLocation } from "react-router";

export type RouteHeadingProps = {
  title: string;
  description?: ReactNode;
  /** 제목 위 "‹ 주문 관리" 링크 — 모바일은 사이드바가 메뉴 뒤에 있어 돌아갈 길이 따로 필요하다. */
  backTo?: { to: string; label: string };
  /** 제목 옆 상태 뱃지 */
  badges?: ReactNode;
  /** 제목 줄 오른쪽(모바일은 아래) 액션 버튼 */
  actions?: ReactNode;
};

export function RouteHeading({
  title,
  description,
  backTo,
  badges,
  actions,
}: RouteHeadingProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const location = useLocation();

  useLayoutEffect(() => {
    document.title = `${title} | ESSE SION 관리자`;
    headingRef.current?.focus({ preventScroll: true });
  }, [location.key, location.pathname, title]);

  return (
    <VStack gap="x3" alignItems="stretch">
      {backTo !== undefined && (
        <Link
          to={backTo.to}
          className="self-start rounded-r1 text-fg-neutral-muted hover:text-fg-neutral focus-visible:outline-2 focus-visible:outline-stroke-focus-ring"
        >
          <HStack gap="x0_5">
            <Icon svg={<ChevronLeftIcon />} size={16} />
            <Text as="span" textStyle="labelSm" color="inherit">
              {backTo.label}
            </Text>
          </HStack>
        </Link>
      )}
      <Flex
        direction="row"
        wrap="wrap"
        justify="space-between"
        align="flex-start"
        gap="x3"
      >
        <VStack gap="x2" minWidth={0}>
          <HStack gap="x2" wrap>
            <Text
              ref={headingRef}
              tabIndex={-1}
              as="h1"
              textStyle="title1"
              className="focus:outline-none"
            >
              {title}
            </Text>
            {badges}
          </HStack>
          {description !== undefined && (
            <Text textStyle="bodySm" color="fg.neutral-muted">
              {description}
            </Text>
          )}
        </VStack>
        {actions !== undefined && (
          <HStack gap="x2" wrap>
            {actions}
          </HStack>
        )}
      </Flex>
    </VStack>
  );
}

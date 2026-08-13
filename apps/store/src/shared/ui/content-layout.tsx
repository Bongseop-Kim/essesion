import {
  Box,
  Divider,
  Grid,
  HStack,
  Icon,
  LayoutContent,
  SnackbarAvoidOverlap,
  Text,
  useBreakpoint,
  VStack,
} from "@essesion/shared";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { Link } from "react-router";

export type ContentLayoutProps = {
  children: ReactNode;
  /** 상단 브레드크럼 — 마지막 항목이 현재 페이지. */
  breadcrumbs?: { href?: string; label: string; key?: string }[];
  /** 우측 요약/결제 컬럼 — PC 1/3 sticky · 모바일 본문 아래로 스택. */
  sidebar?: ReactNode;
  /** 주문·결제 CTA — PC 사이드바 하단 · 모바일 하단 고정바. */
  actionBar?: ReactNode;
  /** 본문 하단 상세(설명·가이드) — 구분선 뒤 배치. */
  detail?: ReactNode;
};

/**
 * store 콘텐츠 레이아웃 (YeongSeon PageLayout 대응).
 * 앱 셸(Header/Footer)은 AppLayout 소유 — 여기선 본문 프레임만 담당.
 * design 캔버스(고정높이)는 이 레이아웃을 쓰지 않는다.
 */
export function ContentLayout({
  children,
  breadcrumbs,
  sidebar,
  actionBar,
  detail,
}: ContentLayoutProps) {
  const bp = useBreakpoint();
  const isDesktop = bp === "lg" || bp === "xl";

  const crumbs = breadcrumbs ? (
    <HStack as="nav" aria-label="탐색 경로" gap="x1" py="x3">
      {breadcrumbs.map((item, index) => {
        const isLast = index === breadcrumbs.length - 1;
        const linkable = item.href !== undefined && !isLast;
        return (
          <HStack as="span" key={item.key ?? item.href ?? item.label} gap="x1">
            {index > 0 ? (
              <Icon
                svg={<ChevronRightIcon />}
                size={12}
                color="fg.neutral-muted"
              />
            ) : null}
            {linkable ? (
              <Link
                to={item.href ?? "#"}
                className="rounded-r1 text-t3 text-fg-neutral-muted transition-colors duration-(--duration-fast) ease-standard hover:text-fg-neutral focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
              >
                {item.label}
              </Link>
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
  ) : null;

  if (isDesktop) {
    return (
      <LayoutContent density="medium" py="x6">
        {crumbs}
        <Grid
          templateColumns={sidebar ? "2fr 1fr" : "1fr"}
          gap="x8"
          alignItems="start"
        >
          <Box minWidth={0}>
            {children}
            {detail ? (
              <Box pt="x8">
                <Divider />
                <Box pt="x8">{detail}</Box>
              </Box>
            ) : null}
          </Box>
          {sidebar ? (
            <Box
              position="sticky"
              top="calc(var(--spacing-x16) + var(--spacing-x3))"
              alignSelf="start"
            >
              {sidebar}
              {actionBar ? <Box pt="x4">{actionBar}</Box> : null}
            </Box>
          ) : null}
        </Grid>
      </LayoutContent>
    );
  }

  return (
    <>
      <LayoutContent density="medium" py="x4">
        {crumbs}
        <VStack gap="x6">
          <Box>{children}</Box>
          {sidebar ? <Divider /> : null}
          {sidebar ? <Box>{sidebar}</Box> : null}
          {detail ? <Divider /> : null}
          {detail ? <Box>{detail}</Box> : null}
        </VStack>
      </LayoutContent>
      {actionBar ? (
        <SnackbarAvoidOverlap>
          {/* sticky — 레이아웃 공간을 차지하므로 스크롤 끝에서 Footer 위에 자리 잡는다(fixed는 Footer를 가림) */}
          <Box
            position="sticky"
            bottom={0}
            zIndex={30}
            bg="bg.layer-default"
            className="border-t border-stroke-neutral-weak"
          >
            <LayoutContent
              density="medium"
              pt="x3"
              style={{
                paddingBottom:
                  "calc(var(--spacing-x3) + env(safe-area-inset-bottom, 0px))",
              }}
            >
              {actionBar}
            </LayoutContent>
          </Box>
        </SnackbarAvoidOverlap>
      ) : null}
    </>
  );
}

import {
  Box,
  Breadcrumb,
  type BreadcrumbItem,
  Divider,
  Grid,
  LayoutContent,
  SnackbarAvoidOverlap,
  useBreakpoint,
  VStack,
} from "@essesion/shared";
import type { ReactNode } from "react";
import { useLayoutEffect, useState } from "react";
import { Link } from "react-router";

export type ContentLayoutProps = {
  children: ReactNode;
  /** 상단 브레드크럼 — 마지막 항목이 현재 페이지. */
  breadcrumbs?: BreadcrumbItem[];
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
  const [actionBarNode, setActionBarNode] = useState<HTMLElement | null>(null);
  const [actionBarHeight, setActionBarHeight] = useState(0);

  useLayoutEffect(() => {
    if (!actionBarNode) {
      setActionBarHeight(0);
      return;
    }
    const update = () => {
      setActionBarHeight(actionBarNode.getBoundingClientRect().height);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(actionBarNode);
    return () => observer.disconnect();
  }, [actionBarNode]);

  const crumbs = breadcrumbs ? (
    <Breadcrumb
      items={breadcrumbs}
      renderLink={(item, props) => <Link to={item.href ?? "#"} {...props} />}
    />
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
      <LayoutContent
        density="medium"
        py="x4"
        style={
          actionBar
            ? {
                paddingBottom: `calc(${actionBarHeight}px + var(--spacing-x4))`,
              }
            : undefined
        }
      >
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
          <Box
            ref={setActionBarNode}
            position="fixed"
            bottom={0}
            left={0}
            right={0}
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

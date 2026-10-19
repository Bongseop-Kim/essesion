import { Box, Flex, Layout, LayoutContent, Text } from "@essesion/shared";
import { Outlet, ScrollRestoration } from "react-router";

import { AdminHeader } from "./admin-header";
import { AdminSidebar } from "./admin-sidebar";

export function AdminShell() {
  return (
    <Layout bg="bg.layer-basement">
      <Box
        as="a"
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-x2 focus:top-x2 focus:z-50 focus:rounded-r2 focus:bg-bg-layer-default focus:px-x3 focus:py-x2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
      >
        <Text as="span" textStyle="labelSm">
          본문으로 건너뛰기
        </Text>
      </Box>
      <AdminHeader />
      <Flex align="stretch" flexGrow minWidth={0}>
        <AdminSidebar />
        <Box as="main" id="main-content" flexGrow minWidth={0}>
          <LayoutContent density="high" py={{ base: "x6", md: "x8" }}>
            <Outlet />
            {/* 쿼리(탭·필터·페이지)만 바뀌면 스크롤을 유지하고 경로가 바뀔 때만 맨 위로 */}
            <ScrollRestoration getKey={(location) => location.pathname} />
          </LayoutContent>
        </Box>
      </Flex>
    </Layout>
  );
}

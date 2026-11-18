import { Box, Grid, Text } from "@essesion/shared";
import type { ReactNode } from "react";

export type DetailItem = {
  label: ReactNode;
  value: ReactNode;
};

/**
 * md 미만은 라벨·값을 한 줄에 나란히 둔다 — 한 칸씩 세로로 쌓으면 상세 화면이 휴대폰에서
 * 몇 화면씩 길어진다. md 이상은 라벨 위·값 아래의 2열.
 */
export function DetailList({ items }: { items: readonly DetailItem[] }) {
  return (
    <Grid as="dl" columns={{ base: 1, md: 2 }} gap={{ base: "x2", md: "x4" }}>
      {items.map((item, index) => (
        <Box
          key={index}
          minWidth={0}
          className="flex gap-x3 md:flex-col md:gap-x1"
        >
          <Box as="dt" width={{ base: 96, md: "auto" }} flexShrink={0}>
            <Text as="span" textStyle="caption" color="fg.neutral-muted">
              {item.label}
            </Text>
          </Box>
          <Box as="dd" minWidth={0} className="m-0 break-words">
            <Text as="span" textStyle="bodySm">
              {item.value}
            </Text>
          </Box>
        </Box>
      ))}
    </Grid>
  );
}

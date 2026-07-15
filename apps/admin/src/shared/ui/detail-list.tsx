import { Box, Grid, Text, VStack } from "@essesion/shared";
import type { ReactNode } from "react";

export type DetailItem = {
  label: ReactNode;
  value: ReactNode;
};

export function DetailList({ items }: { items: readonly DetailItem[] }) {
  return (
    <Grid as="dl" columns={{ base: 1, md: 2 }} gap="x4">
      {items.map((item, index) => (
        <VStack as="div" key={index} gap="x1" minWidth={0}>
          <Text as="dt" textStyle="caption" color="fg.neutral-muted">
            {item.label}
          </Text>
          <Box as="dd" className="m-0 break-words">
            <Text as="span" textStyle="bodySm">
              {item.value}
            </Text>
          </Box>
        </VStack>
      ))}
    </Grid>
  );
}

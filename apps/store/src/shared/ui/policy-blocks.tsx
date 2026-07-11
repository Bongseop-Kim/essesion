import { Article, Box, Text, VStack } from "@essesion/shared";
import type { ReactNode } from "react";

export function PolicyDocument({ children }: { children: ReactNode }) {
  return (
    <Article>
      <VStack gap="x8" alignItems="stretch">
        {children}
      </VStack>
    </Article>
  );
}

export function PolicySection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <VStack as="section" gap="x3" alignItems="stretch">
      <Text as="h2" textStyle="title3">
        {title}
      </Text>
      <VStack gap="x2" alignItems="stretch">
        {children}
      </VStack>
    </VStack>
  );
}

export function PolicyList({ items }: { items: readonly string[] }) {
  return (
    <VStack
      as="ul"
      gap="x1"
      alignItems="stretch"
      pl="x5"
      style={{ listStyleType: "disc" }}
    >
      {items.map((item) => (
        <Text key={item} as="li" textStyle="bodySm" color="fg.neutral-muted">
          {item}
        </Text>
      ))}
    </VStack>
  );
}

export function PolicyInfoBox({ children }: { children: ReactNode }) {
  return (
    <Box bg="bg.neutral-weak" borderRadius="r3" p="x4">
      <VStack gap="x1" alignItems="stretch">
        {children}
      </VStack>
    </Box>
  );
}

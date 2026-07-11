import { Article, Box, Text, VStack } from "@essesion/shared";
import type { ReactNode } from "react";

/** 정책 문서 본문 Text 공통 프롭 — 3개 약관 페이지가 공유. */
export const policyBodyProps = {
  textStyle: "bodySm",
  color: "fg.neutral-muted",
} as const;

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
      {items.map((item, index) => (
        <Text key={`${index}-${item}`} as="li" {...policyBodyProps}>
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

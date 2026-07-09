import { Text, VStack } from "@essesion/shared";
import type { ReactNode } from "react";

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <VStack as="section" gap="x4" width="full" minWidth={0}>
      <Text as="h2" textStyle="title2">
        {title}
      </Text>
      {children}
    </VStack>
  );
}

export function SubSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <VStack gap="x3" width="full" minWidth={0}>
      <Text as="h3" textStyle="label" color="fg.neutral-muted">
        {title}
      </Text>
      {children}
    </VStack>
  );
}

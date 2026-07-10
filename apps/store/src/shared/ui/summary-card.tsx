import { Divider, HStack, Text, VStack } from "@essesion/shared";
import type { ReactNode } from "react";

function Root({ children }: { children: ReactNode }) {
  return (
    <VStack gap="x4" alignItems="stretch">
      {children}
    </VStack>
  );
}

function Section({
  title,
  description,
}: {
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <VStack gap="x1">
      <Text as="h2" textStyle="title3">
        {title}
      </Text>
      {description ? (
        <Text textStyle="caption" color="fg.neutral-muted">
          {description}
        </Text>
      ) : null}
    </VStack>
  );
}

function Row({
  label,
  value,
  tone = "neutral",
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: "neutral" | "informative";
}) {
  return (
    <HStack justify="space-between" gap="x4">
      <Text textStyle="bodySm" color="fg.neutral-muted">
        {label}
      </Text>
      <Text
        textStyle="labelSm"
        color={tone === "informative" ? "fg.informative" : "fg.neutral"}
      >
        {value}
      </Text>
    </HStack>
  );
}

function Total({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <>
      <Divider />
      <HStack justify="space-between" gap="x4">
        <Text textStyle="label" color="fg.neutral-muted">
          {label}
        </Text>
        <Text textStyle="title3">{value}</Text>
      </HStack>
    </>
  );
}

export const SummaryCard = { Root, Section, Row, Total };

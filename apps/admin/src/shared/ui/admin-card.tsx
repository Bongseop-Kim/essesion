import { Box, type BoxProps, HStack, Text, VStack } from "@essesion/shared";
import type { ElementType, ReactNode } from "react";

export type AdminCardProps<E extends ElementType = "section"> = BoxProps<E> & {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
};

export function AdminCard<E extends ElementType = "section">({
  title,
  description,
  action,
  children,
  ...props
}: AdminCardProps<E>) {
  return (
    <Box
      as="section"
      bg="bg.layer-default"
      borderRadius="r3"
      p={{ base: "x4", md: "x5" }}
      className="border border-stroke-neutral-weak"
      {...(props as BoxProps<"section">)}
    >
      <VStack gap="x4" alignItems="stretch">
        {(title !== undefined || action !== undefined) && (
          <HStack justify="space-between" align="flex-start" gap="x4">
            <VStack gap="x1" minWidth={0}>
              {title !== undefined && (
                <Text as="h2" textStyle="title3">
                  {title}
                </Text>
              )}
              {description !== undefined && (
                <Text textStyle="bodySm" color="fg.neutral-muted">
                  {description}
                </Text>
              )}
            </VStack>
            {action}
          </HStack>
        )}
        {children}
      </VStack>
    </Box>
  );
}

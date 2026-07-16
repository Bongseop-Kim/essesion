import { Box, HStack, Text, VStack } from "@essesion/shared";
import type { ReactNode } from "react";

type EditModeShellProps = {
  children: ReactNode;
  status: string;
  actions: ReactNode;
};

/** 긴 편집 화면에서도 현재 상태와 저장·취소 액션을 놓치지 않게 유지한다. */
export function EditModeShell({
  children,
  status,
  actions,
}: EditModeShellProps) {
  return (
    <VStack gap="x4" alignItems="stretch">
      {children}
      <Box
        position="sticky"
        bottom="x3"
        zIndex="z.sticky"
        bg="bg.layer-floating"
        borderRadius="r3"
        boxShadow="s1"
        px="x4"
        py="x3"
        className="border border-stroke-neutral-weak"
      >
        <HStack justify="space-between" gap="x3" wrap>
          <Text textStyle="bodySm" color="fg.neutral-muted">
            {status}
          </Text>
          <HStack gap="x2" wrap>
            {actions}
          </HStack>
        </HStack>
      </Box>
    </VStack>
  );
}

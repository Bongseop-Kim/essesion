import { Box, HStack, Text, VStack } from "@essesion/shared";
import type { ReactNode } from "react";

type EditModeShellProps = {
  /** 생략하면 하단 고정 바만 그린다 — 폼 안 마지막 자리에 둔다. */
  children?: ReactNode;
  status: string;
  actions: ReactNode;
};

/** 긴 편집 화면에서도 현재 상태와 저장·취소 액션을 놓치지 않게 유지한다. */
export function EditModeShell({
  children,
  status,
  actions,
}: EditModeShellProps) {
  const bar = (
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
  );
  // 바만 그릴 때 감싸면 sticky가 자기 크기의 부모 안에 갇혀 고정되지 않는다 — 폼을 부모로 둔다.
  if (children === undefined) return bar;
  return (
    <VStack gap="x4" alignItems="stretch">
      {children}
      {bar}
    </VStack>
  );
}

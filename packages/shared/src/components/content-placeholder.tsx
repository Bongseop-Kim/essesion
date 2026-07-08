import type { ReactNode } from "react";

import { Box } from "./box";
import { VStack } from "./stack";
import { Text } from "./text";

export type ContentPlaceholderProps = {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

/** 빈 상태·결과 없음 표시 — 아이콘·제목·설명·액션을 세로 중앙 정렬. */
export function ContentPlaceholder({
  icon,
  title,
  description,
  action,
  className,
}: ContentPlaceholderProps) {
  return (
    <VStack align="center" gap="x3" py="x12" className={className}>
      {icon !== undefined && (
        <Box className="text-fg-neutral-subtle">{icon}</Box>
      )}
      <Text textStyle="label">{title}</Text>
      {description !== undefined && (
        <Text textStyle="caption" color="fg.neutral-subtle">
          {description}
        </Text>
      )}
      {action}
    </VStack>
  );
}

import type { ElementType } from "react";

import { Box, type BoxProps } from "./box";

/** 앱 셸 루트 — 뷰포트 최소 높이를 채우는 세로 컬럼. */
export function Layout(props: BoxProps) {
  return (
    <Box display="flex" flexDirection="column" minHeight="100dvh" {...props} />
  );
}

const maxWidths = {
  low: 720,
  medium: 1280,
  high: undefined,
} as const;

export type LayoutContentProps<E extends ElementType = "div"> = {
  /** 콘텐츠 최대폭 — low 720 / medium(기본) 1280 / high 제한 없음 */
  density?: keyof typeof maxWidths;
} & BoxProps<E>;

/** 콘텐츠 컨테이너 — 밀도별 최대폭 + 중앙 정렬 + 반응형 페이지 거터(넓어질수록 여백 증가). */
export function LayoutContent<E extends ElementType = "div">({
  density = "medium",
  ...props
}: LayoutContentProps<E>) {
  return (
    <Box
      width="full"
      mx="auto"
      px={{ base: "x4", md: "x6", lg: "x8" }}
      flexGrow
      maxWidth={maxWidths[density]}
      {...(props as BoxProps<ElementType>)}
    />
  );
}

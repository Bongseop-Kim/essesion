import { Box, type BoxProps } from "./box";

/** 앱 셸 루트 — 뷰포트 최소 높이를 채우는 세로 컬럼. */
export function Layout(props: BoxProps) {
  return (
    <Box display="flex" flexDirection="column" minHeight="100dvh" {...props} />
  );
}

const maxWidths = {
  low: 720,
  medium: 1040,
  high: undefined,
} as const;

export type LayoutContentProps = {
  /** 콘텐츠 최대폭 — low 720 / medium(기본) 1040 / high 제한 없음 */
  density?: keyof typeof maxWidths;
} & BoxProps;

/** 콘텐츠 컨테이너 — 밀도별 최대폭 + 중앙 정렬 + 페이지 거터. */
export function LayoutContent({
  density = "medium",
  ...props
}: LayoutContentProps) {
  return (
    <Box
      width="full"
      mx="auto"
      px={{ base: "x4", md: "x6" }}
      flexGrow
      maxWidth={maxWidths[density]}
      {...props}
    />
  );
}

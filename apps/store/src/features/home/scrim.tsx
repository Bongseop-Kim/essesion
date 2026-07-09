import { Box, cn } from "@essesion/shared";

// 텍스트가 붙는 가장자리(from)에만 그라디언트 딤을 깔고 반대쪽은 완전 투명 —
// 이미지 전체를 어둡히지 않는다. bg.image-scrim 토큰을 그라디언트 시작색으로 사용.
const gradientTo = {
  top: "bg-linear-to-b",
  bottom: "bg-linear-to-t",
  left: "bg-linear-to-r",
  right: "bg-linear-to-l",
} as const;

const BAND = "55%"; // 딤이 덮는 폭/높이 — 나머지는 투명

/** 이미지 위 텍스트 가독성용 방향성 스크림. from = 텍스트가 붙는 가장자리(기본 bottom). */
export function Scrim({ from = "bottom" }: { from?: keyof typeof gradientTo }) {
  const horizontal = from === "left" || from === "right";
  return (
    <Box
      position="absolute"
      top={from === "bottom" ? undefined : 0}
      bottom={from === "top" ? undefined : 0}
      left={from === "right" ? undefined : 0}
      right={from === "left" ? undefined : 0}
      width={horizontal ? BAND : undefined}
      height={horizontal ? undefined : BAND}
      className={cn(
        "pointer-events-none",
        gradientTo[from],
        "from-bg-image-scrim to-transparent",
      )}
    />
  );
}

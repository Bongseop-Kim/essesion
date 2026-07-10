import { Box } from "@essesion/shared";

// 텍스트가 붙는 가장자리에만 딤을 깔고 반대쪽은 투명 — 이미지 전체를 어둡히지 않는다.
// 그라디언트 정의는 디자인 시스템 소유: theme.css의 .scrim-* 유틸리티(bg.image-scrim → 투명,
// gradient.md 기능성 예외). 여기선 방향만 고른다.
const scrimClass = {
  top: "scrim-top",
  bottom: "scrim-bottom",
  left: "scrim-left",
  right: "scrim-right",
} as const;

/** 이미지 위 텍스트 가독성용 방향성 스크림. from = 텍스트가 붙는 가장자리(기본 bottom). */
export function Scrim({ from = "bottom" }: { from?: keyof typeof scrimClass }) {
  return (
    <Box
      position="absolute"
      inset={0}
      className={`pointer-events-none ${scrimClass[from]}`}
    />
  );
}

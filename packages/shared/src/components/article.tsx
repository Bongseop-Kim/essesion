import type { CSSProperties } from "react";

import { Box, type BoxProps } from "./box";

export type ArticleProps = Omit<BoxProps<"article">, "as">;

/** 본문 텍스트 컨테이너 — 사용자 선택 허용 + 긴 단어 줄바꿈. */
export function Article({ style, ...props }: ArticleProps) {
  return (
    <Box
      as="article"
      {...props}
      style={{
        userSelect: "text",
        overflowWrap: "break-word",
        ...(style as CSSProperties),
      }}
    />
  );
}

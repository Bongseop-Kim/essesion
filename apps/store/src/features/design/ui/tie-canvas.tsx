import { Box, Flex } from "@essesion/shared";
import type { CSSProperties } from "react";

export type DesignPreviewMode = "repeat" | "tie";

export type TieCanvasProps = {
  /** Sanitized SVG encoded as a data URI. */
  imageSrc: string;
  mode: DesignPreviewMode;
  alt?: string;
  className?: string;
};

// 넥타이 실루엣·그림자 기하의 기준 프레임. 그림자 PNG(원본 397×864)는 프레임
// 폭에 맞춰 축소해 top -58px, left 0에 얹으면 마스크 실루엣과 정렬된다
// (아트워크 중심 198/397 ≈ 프레임 중심 158/316).
const TIE_FRAME = { width: 316, height: 600 };
const TIE_SHADOW = { width: 397, height: 864, top: -58 };

const tieMaskStyle: CSSProperties = {
  maskImage: "url(/images/tie.svg)",
  maskSize: "contain",
  maskPosition: "center",
  maskRepeat: "no-repeat",
  WebkitMaskImage: "url(/images/tie.svg)",
  WebkitMaskSize: "contain",
  WebkitMaskPosition: "center",
  WebkitMaskRepeat: "no-repeat",
};

const tieShadowStyle: CSSProperties = {
  top: `${(TIE_SHADOW.top / TIE_FRAME.height) * 100}%`,
  left: 0,
  width: "100%",
  aspectRatio: `${TIE_SHADOW.width} / ${TIE_SHADOW.height}`,
  backgroundImage: "url(/images/tie-shadow.png)",
  backgroundSize: "100% 100%",
  backgroundRepeat: "no-repeat",
  pointerEvents: "none",
};

export function TieCanvas({
  imageSrc,
  mode,
  alt = "선택한 디자인 미리보기",
  className,
}: TieCanvasProps) {
  const backgroundStyle = {
    backgroundImage: `url(${JSON.stringify(imageSrc)})`,
    backgroundRepeat: "repeat",
    backgroundSize: `${mode === "repeat" ? 28 : 16}% auto`,
    backgroundPosition: "center",
  } as const;

  return (
    <Box
      position="relative"
      width="full"
      height="full"
      overflow="hidden"
      borderRadius="r4"
      bg="bg.neutral-weak"
      className={className}
      // 부모가 높이를 정하면(미리보기 패널) 그 영역을 그대로 채우고,
      // 높이가 불확정이면(모달) aspectRatio가 적용되어 폭 기준 정사각이 된다.
      style={{ aspectRatio: 1 }}
    >
      {mode === "repeat" ? (
        <Box
          position="absolute"
          inset={0}
          role="img"
          aria-label={alt}
          className="transition-all duration-100 ease-standard"
          style={backgroundStyle}
        />
      ) : (
        <Flex
          position="absolute"
          inset={0}
          align="center"
          justify="center"
          p="x6"
        >
          <Box
            position="relative"
            height="full"
            style={{ aspectRatio: `${TIE_FRAME.width} / ${TIE_FRAME.height}` }}
          >
            <Box position="absolute" inset={0} style={tieMaskStyle}>
              <Box
                position="absolute"
                inset={0}
                role="img"
                aria-label={`${alt}, 넥타이 적용 모습`}
                className="transition-all duration-100 ease-standard"
                style={backgroundStyle}
              />
            </Box>
            <Box position="absolute" aria-hidden style={tieShadowStyle} />
          </Box>
        </Flex>
      )}
    </Box>
  );
}

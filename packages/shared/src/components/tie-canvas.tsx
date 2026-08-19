import type { CSSProperties } from "react";

import { Box } from "./box";
import { Flex } from "./flex";

export type DesignPreviewMode = "repeat" | "tie";

// 소비하는 앱의 public/images에 tie.svg·tie-shadow.png가 있어야 한다(store·admin 모두 보유).

export type TieCanvasProps = {
  /** Sanitized SVG encoded as a data URI. */
  imageSrc: string;
  mode: DesignPreviewMode;
  alt?: string;
  /**
   * `panel`(기본) = 라운드 면 위에 얹는다(미리보기 패널·모달).
   * `none` = 면·라운드 없이 부모 배경에 바로 놓는다(풀블리드 캔버스).
   */
  surface?: "panel" | "none";
  /** 타일 반복 배율 — SVG 루트의 물리 폭(tile_mm/48)에 비례시킨다. 기본 1. */
  tileScale?: number;
  className?: string;
};

// 넥타이 실루엣(마스크)과 그림자 PNG(원본 397×864)의 기하. 그림자를 프레임 폭에
// 맞춰 축소해 top -58px, left 0에 얹으면 마스크 실루엣과 정렬된다
// (아트워크 중심 198/397 ≈ 프레임 중심 158/316).
const TIE_FRAME = { width: 316, height: 600 };
const TIE_SHADOW = { width: 397, height: 864, top: -58 };
// 레이아웃 단위는 마스크가 아니라 그림자까지 포함한 아트워크 박스 — 마스크 기준으로
// 잡으면 칼라가 위로 삐져나가 잘리고 무게중심도 위로 치우친다.
const TIE_ART_HEIGHT = (TIE_FRAME.width * TIE_SHADOW.height) / TIE_SHADOW.width;
const TIE_MASK_TOP = -TIE_SHADOW.top / TIE_ART_HEIGHT;
const TIE_MASK_HEIGHT = TIE_FRAME.height / TIE_ART_HEIGHT;

/**
 * 미리보기 기하 — 화면과 같은 그림을 캔버스로 합성해 내려받을 때 함께 쓴다.
 * 여기서 갈라지면 내려받은 파일이 화면과 달라진다. 비율은 아트 박스 기준.
 */
export const TIE_GEOMETRY = {
  /** 아트 박스(그림자 포함) 폭 대비 높이. */
  artAspect: TIE_ART_HEIGHT / TIE_FRAME.width,
  /** 실루엣 마스크 박스 — 아트 박스 상단에서의 오프셋·높이 비율(폭은 아트 박스와 같다). */
  maskTop: TIE_MASK_TOP,
  maskHeight: TIE_MASK_HEIGHT,
  /** 마스크 박스 폭 대비 타일 한 장의 폭. */
  tileFraction: { tie: 0.16, repeat: 0.28 },
} as const;

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
  inset: 0,
  backgroundImage: "url(/images/tie-shadow.png)",
  backgroundSize: "100% 100%",
  backgroundRepeat: "no-repeat",
  pointerEvents: "none",
};

export function TieCanvas({
  imageSrc,
  mode,
  alt = "선택한 디자인 미리보기",
  surface = "panel",
  tileScale = 1,
  className,
}: TieCanvasProps) {
  const backgroundStyle = {
    backgroundImage: `url(${JSON.stringify(imageSrc)})`,
    backgroundRepeat: "repeat",
    backgroundSize: `${TIE_GEOMETRY.tileFraction[mode] * tileScale * 100}% auto`,
    backgroundPosition: "center",
  } as const;

  return (
    <Box
      position="relative"
      width="full"
      height="full"
      overflow="hidden"
      borderRadius={surface === "panel" ? "r4" : undefined}
      bg={surface === "panel" ? "bg.neutral-weak" : undefined}
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
            style={{ aspectRatio: `${TIE_FRAME.width} / ${TIE_ART_HEIGHT}` }}
          >
            <Box
              position="absolute"
              left={0}
              right={0}
              style={{
                top: `${TIE_MASK_TOP * 100}%`,
                height: `${TIE_MASK_HEIGHT * 100}%`,
                ...tieMaskStyle,
              }}
            >
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

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

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
  /**
   * `tie` 모드 확대 샷 — `knot`은 매듭, `tip`은 아래 끝을 프레임에 꽉 채운다.
   * 전체 샷만으로는 무늬 디테일이 안 보여 템플릿 카드가 3샷(전체·매듭·끝)으로 쓴다.
   */
  focus?: "knot" | "blade" | "tip";
  /**
   * 포인트 로고 — 넥타이 한 곳(매듭 또는 아래 끝)에 놓이는 비반복 요소. `svg`는 `<symbol>`
   * 마크업이고 viewBox는 -0.5..0.5 정규 좌표(모티프 계약)다. 확대 샷에서도 같은 자리에 따라간다.
   */
  emblem?: { svg: string; at: "knot" | "tip" };
  className?: string;
};

// 포인트 로고 자리 — 아트 박스 기준 중심 y와 폭(아트 박스 폭 대비). 블레이드 폭(약 40%) 안에 든다.
const TIE_EMBLEM = {
  knot: { y: 0.145, width: 0.13 },
  tip: { y: 0.8, width: 0.2 },
} as const;

// 확대 샷 기하 — 아트 박스 폭을 프레임의 2.2배로 키우면 블레이드(마스크 폭의 약 40%)가
// 프레임을 거의 채운다. y는 아트 박스 높이 기준 초점(매듭 중심·블레이드 중간·아래 끝).
const TIE_FOCUS = {
  zoom: 2.2,
  y: { knot: 0.16, blade: 0.66, tip: 0.84 },
} as const;
const TIE_FOCUS_LABEL = {
  knot: "매듭 확대",
  blade: "무늬 확대",
  tip: "아래 끝 확대",
} as const;

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
  focus,
  emblem,
  className,
}: TieCanvasProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);

  // repeat 모드의 타일 폭을 정수 px로 스냅하기 위한 실측 — %로 두면 타일 폭이 소수 px가
  // 되고 반복마다 반올림 위상이 달라져 경계에 부모 배경이 비치는 흰 선이 생긴다.
  useEffect(() => {
    const el = frameRef.current;
    // jsdom(테스트)에는 ResizeObserver가 없다 — 없으면 % 폴백을 그대로 쓴다.
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setFrameWidth(el.getBoundingClientRect().width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const backgroundStyle = {
    backgroundImage: `url(${JSON.stringify(imageSrc)})`,
    backgroundRepeat: "repeat",
    backgroundSize: `${TIE_GEOMETRY.tileFraction[mode] * tileScale * 100}% auto`,
    backgroundPosition: "center",
  } as const;

  // 정수 px 타일 + 원점 정렬(center의 반칸 오프셋도 소수를 만든다). 타일은 정사각이라
  // 두 축에 같은 값을 줘 auto가 소수 높이를 만드는 경로까지 막는다.
  const repeatTilePx = Math.max(
    1,
    Math.round(frameWidth * TIE_GEOMETRY.tileFraction.repeat * tileScale),
  );
  const repeatStyle =
    frameWidth === 0
      ? backgroundStyle
      : {
          ...backgroundStyle,
          backgroundSize: `${repeatTilePx}px ${repeatTilePx}px`,
          backgroundPosition: "0 0",
        };

  // 확대 샷은 가운데 정렬 대신 아트 박스를 프레임보다 크게 절대 배치해 초점을 프레임 중앙에
  // 둔다. 초점 이동은 아트 박스 자신의 높이 %(translate)로 해서 프레임 비율(정사각·3:4)과 무관하다.
  const focusStyle: CSSProperties | undefined = focus
    ? {
        width: `${TIE_FOCUS.zoom * 100}%`,
        left: "50%",
        top: "50%",
        transform: `translate(-50%, -${TIE_FOCUS.y[focus] * 100}%)`,
        aspectRatio: `${TIE_FRAME.width} / ${TIE_ART_HEIGHT}`,
      }
    : undefined;

  const art = (
    <Box
      position={focus ? "absolute" : "relative"}
      height={focus ? undefined : "full"}
      style={
        focusStyle ?? {
          aspectRatio: `${TIE_FRAME.width} / ${TIE_ART_HEIGHT}`,
        }
      }
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
          aria-label={`${alt}, ${focus ? TIE_FOCUS_LABEL[focus] : "넥타이 적용 모습"}`}
          className="transition-all duration-100 ease-standard"
          style={backgroundStyle}
        />
      </Box>
      {emblem ? (
        <Box
          position="absolute"
          aria-hidden
          color="fg.neutral"
          style={{
            left: "50%",
            top: `${TIE_EMBLEM[emblem.at].y * 100}%`,
            width: `${TIE_EMBLEM[emblem.at].width * 100}%`,
            aspectRatio: 1,
            transform: "translate(-50%, -50%)",
          }}
        >
          <svg
            viewBox="-0.5 -0.5 1 1"
            width="100%"
            height="100%"
            role="presentation"
          >
            <g dangerouslySetInnerHTML={{ __html: emblem.svg }} />
            <use href={`#${/id="([^"]+)"/.exec(emblem.svg)?.[1] ?? ""}`} />
          </svg>
        </Box>
      ) : null}
      <Box position="absolute" aria-hidden style={tieShadowStyle} />
    </Box>
  );

  return (
    <Box
      position="relative"
      width="full"
      height="full"
      overflow="hidden"
      borderRadius={surface === "panel" ? "r4" : undefined}
      bg={surface === "panel" ? "bg.neutral-weak" : undefined}
      className={className}
      ref={frameRef}
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
          // background 크기를 전환하면 중간 소수 값이 그려져 흰 선이 다시 보인다 — 전환 없음.
          style={repeatStyle}
        />
      ) : focus ? (
        art
      ) : (
        <Flex
          position="absolute"
          inset={0}
          align="center"
          justify="center"
          p="x6"
        >
          {art}
        </Flex>
      )}
    </Box>
  );
}

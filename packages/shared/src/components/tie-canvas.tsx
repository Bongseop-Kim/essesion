import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

import { Box } from "./box";
import { Flex } from "./flex";

export type DesignPreviewMode = "repeat" | "tie";

// 소비하는 앱의 public/images에 tie-mask.png·tie-knot-mask.png·tie-shadow.webp가 있어야 한다(store·admin 모두 보유).
// `silhouette="flat"`은 tie-flat-mask.png·tie-flat-shadow.webp도 필요하다(store만 보유).

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
  /**
   * `photo`(기본) = 셔츠 깃·매듭까지 있는 실사 컷. `flat` = 매듭 없이 몸통 위를 수평으로 자른
   * 정면 컷(템플릿 목록) — 매듭이 없어 `knot` 자리는 몸통 윗부분이다.
   */
  silhouette?: "photo" | "flat";
  className?: string;
};

const TIE_FOCUS_LABEL = {
  knot: "매듭 확대",
  blade: "무늬 확대",
  tip: "아래 끝 확대",
} as const;

// 실루엣별 기하 — 마스크·명암 이미지는 같은 크기의 한 장짜리 아트 박스이고, 값은 모두 그 비율이다.
// - emblem: 포인트 로고 중심 y와 폭(아트 박스 폭 대비). 블레이드 폭 안에 든다.
// - focus: 확대 샷 — 아트 박스 폭을 프레임의 zoom배로 키우고, y(아트 박스 높이 기준)를 프레임 중앙에.
// - tile: 아트 박스 폭 대비 타일 한 장의 폭 — 블레이드 폭 대비 타일 크기가 두 실루엣에서 같게.
const SILHOUETTES = {
  // 실사 베이스 사진(worker assets/photo/tie-base.png)에서 추출 — extract_tie_assets.py. 794×2097,
  // 블레이드 최대 폭 = 아트 폭의 0.393, 매듭:몸통 = 1:11.
  photo: {
    mask: "/images/tie-mask.png",
    knotMask: "/images/tie-knot-mask.png",
    shadow: "/images/tie-shadow.webp",
    aspect: 794 / 2097,
    tile: 0.16,
    emblem: { knot: { y: 0.06, width: 0.13 }, tip: { y: 0.865, width: 0.2 } },
    // tip 0.91 — 0.93이면 정사각 칸(상세)에서 끝 엠블럼(0.865) 윗부분이 잘린다.
    focus: { zoom: 2.2, y: { knot: 0.09, blade: 0.5, tip: 0.91 } },
  },
  // 평면 컷 사진(레포 밖 원본)에서 추출 — extract_tie_flat_assets.py. 928×1172,
  // 블레이드 폭 = 아트 폭의 0.91, 윗변 y 0.03·어깨 0.60·끝 0.97.
  flat: {
    mask: "/images/tie-flat-mask.png",
    knotMask: null,
    shadow: "/images/tie-flat-shadow.webp",
    aspect: 928 / 1172,
    tile: 0.37,
    emblem: { knot: { y: 0.2, width: 0.3 }, tip: { y: 0.74, width: 0.26 } },
    focus: { zoom: 1.8, y: { knot: 0.22, blade: 0.45, tip: 0.78 } },
  },
} as const;

// repeat 모드: 프레임 폭 대비 타일 한 장의 폭.
const REPEAT_TILE_FRACTION = 0.28;

function maskStyle(src: string): CSSProperties {
  return {
    maskImage: `url(${src})`,
    maskSize: "contain",
    maskPosition: "center",
    maskRepeat: "no-repeat",
    WebkitMaskImage: `url(${src})`,
    WebkitMaskSize: "contain",
    WebkitMaskPosition: "center",
    WebkitMaskRepeat: "no-repeat",
  };
}

export function TieCanvas({
  imageSrc,
  mode,
  alt = "선택한 디자인 미리보기",
  surface = "panel",
  tileScale = 1,
  focus,
  emblem,
  silhouette = "photo",
  className,
}: TieCanvasProps) {
  const geom = SILHOUETTES[silhouette];
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
    backgroundSize: `${(mode === "tie" ? geom.tile : REPEAT_TILE_FRACTION) * tileScale * 100}% auto`,
    backgroundPosition: "center",
  } as const;

  // 정수 px 타일 + 원점 정렬(center의 반칸 오프셋도 소수를 만든다). 타일은 정사각이라
  // 두 축에 같은 값을 줘 auto가 소수 높이를 만드는 경로까지 막는다.
  const repeatTilePx = Math.max(
    1,
    Math.round(frameWidth * REPEAT_TILE_FRACTION * tileScale),
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
        width: `${geom.focus.zoom * 100}%`,
        left: "50%",
        top: "50%",
        transform: `translate(-50%, -${geom.focus.y[focus] * 100}%)`,
        aspectRatio: geom.aspect,
      }
    : undefined;

  const art = (
    <Box
      position={focus ? "absolute" : "relative"}
      style={
        focusStyle ?? {
          // 프레임(컨테이너) 안에 contain — 세로로 긴 실사 컷은 높이, 평면 컷은 폭이 먼저 닿는다.
          width: `min(100cqw, 100cqh * ${geom.aspect})`,
          aspectRatio: geom.aspect,
        }
      }
    >
      <Box position="absolute" inset={0} style={maskStyle(geom.mask)}>
        <Box
          position="absolute"
          inset={0}
          role="img"
          aria-label={`${alt}, ${focus ? TIE_FOCUS_LABEL[focus] : "넥타이 적용 모습"}`}
          className="transition-all duration-100 ease-standard"
          style={backgroundStyle}
        />
      </Box>
      {/* 매듭은 천이 감겨 무늬 방향이 몸통과 반대다 — 매듭 마스크 안에 좌우 반전 무늬를 얹는다.
          사진에서 딴 매듭은 좌우 비대칭이라 마스크는 두고 안쪽 무늬만 뒤집는다. */}
      {geom.knotMask ? (
        <Box
          position="absolute"
          inset={0}
          aria-hidden
          style={maskStyle(geom.knotMask)}
        >
          <Box
            position="absolute"
            inset={0}
            className="transition-all duration-100 ease-standard"
            style={{ ...backgroundStyle, transform: "scaleX(-1)" }}
          />
        </Box>
      ) : null}
      {emblem ? (
        <Box
          position="absolute"
          aria-hidden
          color="fg.neutral"
          style={{
            left: "50%",
            top: `${geom.emblem[emblem.at].y * 100}%`,
            width: `${geom.emblem[emblem.at].width * 100}%`,
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
      <Box
        position="absolute"
        aria-hidden
        inset={0}
        style={{
          pointerEvents: "none",
          backgroundImage: `url(${geom.shadow})`,
          backgroundSize: "100% 100%",
          backgroundRepeat: "no-repeat",
        }}
      />
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
          style={{ containerType: "size" }}
        >
          {art}
        </Flex>
      )}
    </Box>
  );
}

import type { CSSProperties } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Box } from "./box";
import { Flex } from "./flex";

export type DesignPreviewMode = "repeat" | "tie";

// 소비하는 앱의 public/images에 tie-mask.png·tie-knot-mask.png·tie-shadow.webp가 있어야 한다(store·admin 모두 보유).
// `silhouette="flat"`은 tie-flat-mask.png·tie-flat-shadow.webp,
// `silhouette="knot"`은 tie-knot-closeup-{mask,knot-mask}.png·tie-knot-closeup-shadow.webp도 필요하다(store만 보유).

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
   * 배치형(panel) 요소 — 블레이드에 한 번만 놓이는 무늬·포인트 로고(대각 분할, 곡선 띠 등).
   * 디자인 응답의 `panel_svg`를 data URI로. 블레이드 프레임(viewBox `0 -4600 1000 6200`, x는
   * 어깨 폭 0..1000, 어깨선 y=1000)을 실루엣의 `blade`로 사상해 무늬 위·명암 아래에 얹는다.
   */
  panelSrc?: string;
  /**
   * `photo`(기본) = 셔츠 깃·매듭까지 있는 실사 컷. `flat` = 매듭 없이 몸통 위를 수평으로 자른
   * 정면 컷(템플릿 목록) — 매듭이 없어 `knot` 자리는 몸통 윗부분이다. `knot` = 실사 사진을 매듭
   * 둘레만 4:5로 자른 확대 컷(색·로고의 매듭 보기) — 셔츠가 칸을 꽉 채워 안쪽 여백이 없다.
   */
  silhouette?: "photo" | "flat" | "knot";
  className?: string;
};

const TIE_FOCUS_LABEL = {
  knot: "매듭 확대",
  blade: "무늬 확대",
  tip: "아래 끝 확대",
} as const;

// 실루엣별 기하 — 마스크·명암 이미지는 같은 크기의 한 장짜리 아트 박스이고, 값은 모두 그 비율이다.
// - emblem: 포인트 로고 자리. 로고마다 가로세로 비가 달라 한 점·한 폭으로 못 맞춘다 — 실측한 로고
//   외곽(getBBox)을 면적 기준 크기 `size`(같은 면적의 정사각 한 변, 아트 폭 대비)로 키우고
//   `maxW`·`maxH`(아트 폭 대비)로 자른 뒤, `anchor` 점(x=폭 비, y=높이 비)에 붙인다. `center`는
//   로고 중심, `bottom-right`는 오른쪽 아래 모서리를 그 점에 둔다 — 넓은 로고는 왼쪽, 높은 로고는
//   위로 자라 오른쪽 여백과 바닥선이 로고와 무관하게 같다(넥타이 샘플의 끝 로고 배치).
// - focus: 확대 샷 — 아트 박스 폭을 프레임의 zoom배로 키우고, y(아트 박스 높이 기준)를 프레임 중앙에.
// - tile: 아트 박스 폭 대비 타일 한 장의 폭 — 블레이드 폭 대비 타일 크기가 두 실루엣에서 같게.
// - blade: 배치형(panel) 사상 — 어깨(끝이 좁아지기 시작하는 줄)에서 블레이드 왼·오른 가장자리(폭 비)와
//   어깨선 높이(높이 비). 마스크 실측값이고, worker photoreal의 `_PHOTO_BLADE_*`와 같아야 한다.
const SILHOUETTES = {
  // 실사 베이스 사진(worker assets/photo/tie-base.png)에서 추출 — extract_tie_assets.py. 794×2097,
  // 블레이드 최대 폭 = 아트 폭의 0.393, 매듭:몸통 = 1:11.
  photo: {
    mask: "/images/tie-mask.png",
    knotMask: "/images/tie-knot-mask.png",
    shadow: "/images/tie-shadow.webp",
    aspect: 794 / 2097,
    tile: 0.16,
    blade: { left: 0.305, right: 0.694, shoulder: 0.918 },
    emblem: {
      knot: {
        anchor: "center",
        x: 0.5,
        y: 0.06,
        size: 0.13,
        maxW: 0.2,
        maxH: 0.2,
      },
      tip: {
        anchor: "bottom-right",
        x: 0.66,
        y: 0.86,
        size: 0.06,
        maxW: 0.12,
        maxH: 0.09,
      },
    },
    // tip 0.85 — 정사각 칸(상세)에서 끝 엠블럼(바닥 0.86)과 끝이 좁아지는 자리(0.92)가 함께 들어온다.
    focus: { zoom: 2.2, y: { knot: 0.09, blade: 0.5, tip: 0.85 } },
  },
  // 평면 컷 사진(레포 밖 원본)에서 추출 — extract_tie_flat_assets.py. 928×1172,
  // 블레이드 폭 = 아트 폭의 0.91, 윗변 y 0.03·어깨 0.60·끝 0.97.
  flat: {
    mask: "/images/tie-flat-mask.png",
    knotMask: null,
    shadow: "/images/tie-flat-shadow.webp",
    aspect: 928 / 1172,
    tile: 0.37,
    blade: { left: 0.045, right: 0.951, shoulder: 0.601 },
    emblem: {
      knot: {
        anchor: "center",
        x: 0.5,
        y: 0.2,
        size: 0.3,
        maxW: 0.5,
        maxH: 0.4,
      },
      tip: {
        anchor: "bottom-right",
        x: 0.85,
        y: 0.585,
        size: 0.13,
        maxW: 0.26,
        maxH: 0.2,
      },
    },
    focus: { zoom: 1.8, y: { knot: 0.22, blade: 0.45, tip: 0.78 } },
  },
  // 실사 베이스 사진의 매듭 둘레를 사진 해상도로 자른 600×750 — extract_tie_assets.py의 확대 컷.
  // 값은 photo 상수를 확대 컷 좌표로 옮긴 것(스크립트가 출력) — 어깨·끝은 칸 밖(>1)이다.
  knot: {
    mask: "/images/tie-knot-closeup-mask.png",
    knotMask: "/images/tie-knot-closeup-knot-mask.png",
    shadow: "/images/tie-knot-closeup-shadow.webp",
    aspect: 600 / 750,
    tile: 0.3664,
    blade: { left: 0.0534, right: 0.9443, shoulder: 4.4407 },
    emblem: {
      knot: {
        anchor: "center",
        x: 0.5,
        y: 0.2902,
        size: 0.2977,
        maxW: 0.458,
        maxH: 0.458,
      },
      tip: {
        anchor: "bottom-right",
        x: 0.8664,
        y: 4.1601,
        size: 0.1374,
        maxW: 0.2748,
        maxH: 0.2061,
      },
    },
    // 이미 확대 컷이라 focus는 쓰지 않는다 — 타입을 맞추는 값.
    focus: { zoom: 1, y: { knot: 0.5, blade: 0.5, tip: 0.5 } },
  },
} as const;

// repeat 모드: 프레임 폭 대비 타일 한 장의 폭.
const REPEAT_TILE_FRACTION = 0.28;

// panel SVG의 블레이드 프레임 viewBox — worker `engine.panel.PANEL_VIEWBOX`와 결속.
const PANEL_VIEWBOX = { y: -4600, width: 1000, height: 6200, shoulder: 1000 };

/** 블레이드 프레임 viewBox를 아트 박스 비율(left·width는 폭, top·height는 높이)로 — 등방 사상. */
export function panelBox(
  blade: { left: number; right: number; shoulder: number },
  artAspect: number,
) {
  const width = blade.right - blade.left;
  // 프레임 1 단위 = 아트 폭의 width/1000 → 높이 비로는 aspect를 곱한다(높이 = 폭/aspect).
  const unit = (width / PANEL_VIEWBOX.width) * artAspect;
  return {
    left: blade.left,
    width,
    top: blade.shoulder - (PANEL_VIEWBOX.shoulder - PANEL_VIEWBOX.y) * unit,
    height: PANEL_VIEWBOX.height * unit,
  };
}

type EmblemGeom = {
  anchor: "center" | "bottom-right";
  x: number;
  y: number;
  size: number;
  maxW: number;
  maxH: number;
};
type Rect = { x: number; y: number; width: number; height: number };

// 모티프 계약상 로고는 -0.5..0.5 정사각 안에 든다 — 실측 전·실측 불가(jsdom)면 그 칸 전체.
const UNIT_RECT: Rect = { x: -0.5, y: -0.5, width: 1, height: 1 };

/** 실측 외곽을 면적 기준으로 키워 anchor 점에 붙인 박스 — left·width는 폭 %, top은 높이 %. */
export function emblemBox(geom: EmblemGeom, rect: Rect, artAspect: number) {
  const ratio = rect.width / rect.height;
  let width = geom.size * Math.sqrt(ratio);
  let height = geom.size / Math.sqrt(ratio);
  const shrink = Math.min(1, geom.maxW / width, geom.maxH / height);
  width *= shrink;
  height *= shrink;
  // 높이는 아트 폭 단위 — 아트 높이(1/aspect) 대비로 바꿔 top %에 쓴다.
  const heightOfArt = height * artAspect;
  const left = geom.anchor === "center" ? geom.x - width / 2 : geom.x - width;
  const top =
    geom.anchor === "center" ? geom.y - heightOfArt / 2 : geom.y - heightOfArt;
  return { left, top, width, height: heightOfArt };
}

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
  panelSrc,
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

  // 포인트 로고의 실제 외곽 — 모티프는 긴 변 기준 정규화라 가로세로 비가 로고마다 다르다.
  const emblemRef = useRef<SVGUseElement>(null);
  const [emblemRect, setEmblemRect] = useState<Rect>(UNIT_RECT);
  const emblemSvg = emblem?.svg;
  useLayoutEffect(() => {
    const el = emblemRef.current;
    if (!emblemSvg || !el || typeof el.getBBox !== "function") {
      setEmblemRect(UNIT_RECT);
      return;
    }
    const { x, y, width, height } = el.getBBox();
    setEmblemRect(
      width > 0 && height > 0 ? { x, y, width, height } : UNIT_RECT,
    );
  }, [emblemSvg]);
  const emblemPos = emblem
    ? emblemBox(geom.emblem[emblem.at], emblemRect, geom.aspect)
    : null;

  const panelPos = panelSrc ? panelBox(geom.blade, geom.aspect) : null;

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
        {panelSrc && panelPos ? (
          <Box
            position="absolute"
            aria-hidden
            style={{
              left: `${panelPos.left * 100}%`,
              top: `${panelPos.top * 100}%`,
              width: `${panelPos.width * 100}%`,
              height: `${panelPos.height * 100}%`,
              backgroundImage: `url(${JSON.stringify(panelSrc)})`,
              backgroundSize: "100% 100%",
              backgroundRepeat: "no-repeat",
            }}
          />
        ) : null}
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
      {emblem && emblemPos ? (
        <Box
          position="absolute"
          aria-hidden
          color="fg.neutral"
          style={{
            left: `${emblemPos.left * 100}%`,
            top: `${emblemPos.top * 100}%`,
            width: `${emblemPos.width * 100}%`,
            height: `${emblemPos.height * 100}%`,
          }}
        >
          <svg
            viewBox={`${emblemRect.x} ${emblemRect.y} ${emblemRect.width} ${emblemRect.height}`}
            width="100%"
            height="100%"
            role="presentation"
            style={{ overflow: "visible" }}
          >
            <g dangerouslySetInnerHTML={{ __html: emblem.svg }} />
            <use
              ref={emblemRef}
              href={`#${/id="([^"]+)"/.exec(emblem.svg)?.[1] ?? ""}`}
            />
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
          // 확대 컷은 셔츠 사진이 칸을 꽉 채워야 한다 — 안쪽 여백 없음.
          p={silhouette === "knot" ? undefined : "x6"}
          style={{ containerType: "size" }}
        >
          {art}
        </Flex>
      )}
    </Box>
  );
}

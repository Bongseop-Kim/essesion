import type { DesignExampleOut, DesignSessionOut } from "@essesion/api-client";
import {
  Box,
  Float,
  Grid,
  HStack,
  ImageFrame,
  Text,
  TieCanvas,
  VStack,
} from "@essesion/shared";
import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * 템플릿의 포인트 위치 — 사진 구성을 정한다. 전체 샷과 기본 무늬 확대는 공통이고,
 * 포인트(로고 자리)가 상단이면 매듭 확대, 하단이면 아래 끝 확대를 더한다. 올패턴은 추가 없음.
 */
export type TemplatePoint = DesignExampleOut["point"];

/**
 * 샷 구성에 필요한 템플릿 데이터 — 포인트 위치, 포인트 자리의 엠블럼(`<symbol>`), 실사 사진.
 * 템플릿 페이지는 `templateLayout`, 세션 페이지(색·로고)는 `sessionLayout`으로 만든다.
 */
export type TemplateLayout = {
  point: TemplatePoint;
  emblemSvg: string | null;
  /** 사용자가 준비한 실사 사진 — 있으면 그 자리에 사진, 없으면 결정론 샷 */
  photos?: { full: string | null; detail: string | null };
};

/** 모티프 미리보기 SVG(`<svg><defs><symbol …>`)에서 엠블럼용 `<symbol>`만 꺼낸다 — TieCanvas 계약. */
export function emblemSymbol(previewSvg: string | null | undefined) {
  return previewSvg
    ? (/<symbol[\s\S]*?<\/symbol>/.exec(previewSvg)?.[0] ?? null)
    : null;
}

export function templateLayout(template: DesignExampleOut): TemplateLayout {
  return {
    point: template.point,
    emblemSvg: emblemSymbol(template.logo_preview_svg),
    photos: {
      full: template.photo_full_url,
      detail: template.photo_detail_url,
    },
  };
}

/**
 * 세션은 시작한 템플릿(`example_id`)의 포인트 위치를 쓰고, 엠블럼은 로고 슬롯에 지금 들어 있는
 * 모티프(로고를 넣은 뒤면 로고)다. 사진은 안 쓴다 — 색·로고가 바뀐 디자인과 맞지 않는다.
 */
export function sessionLayout(
  session: DesignSessionOut,
  template: DesignExampleOut | undefined,
): TemplateLayout {
  // 서버의 로고 슬롯 규칙과 같다(router `place_design_logo`).
  const motifs = session.current_motifs ?? [];
  const slot = template?.logo_slot ?? (motifs.length >= 2 ? 2 : 1);
  return {
    point: template?.point ?? "none",
    emblemSvg: emblemSymbol(motifs[slot - 1]?.preview_svg),
  };
}

function templateEmblem({ point, emblemSvg }: TemplateLayout) {
  return point === "none" || !emblemSvg
    ? undefined
    : ({ svg: emblemSvg, at: point === "top" ? "knot" : "tip" } as const);
}

export type TemplateShot = {
  imageSrc: string;
  alt: string;
  tileScale: number;
  surface: "none";
};

type Colorway = DesignExampleOut["colorways"][number];

/** 배색 이름 — 엔진 기본 배색(`default`)은 이름 대신 "기본". 색 고르기 화면과 같은 규칙. */
export function colorwayName({
  id,
  name,
}: {
  id: string;
  name?: string | null;
}) {
  return id !== "default" && name ? name : "기본";
}

/** "배색 N종" 라벨 + 바탕·무늬 반반 동그라미 — 색 고르기 화면의 선택지를 같은 모양으로 미리 보여준다. */
export function TemplateSwatches({
  colorways,
}: {
  colorways: readonly Colorway[];
}) {
  if (colorways.length === 0) return null;
  return (
    <VStack alignItems="start" gap="x1_5">
      <Text as="span" textStyle="caption" color="fg.neutral-muted">
        배색 {colorways.length}종
      </Text>
      <HStack gap="x1_5" flexWrap="wrap">
        {colorways.map((colorway) => {
          const [bg, accent = bg] = Object.values(colorway.mapping);
          return (
            <Box
              key={colorway.id}
              as="span"
              role="img"
              aria-label={colorwayName(colorway)}
              width={20}
              height={20}
              borderRadius="full"
              borderWidth={1}
              borderColor="stroke.neutral-weak"
              style={{
                background: `linear-gradient(135deg, ${bg} 50%, ${accent} 50%)`,
              }}
            />
          );
        })}
      </HStack>
    </VStack>
  );
}

/** 셀을 꽉 채우는 TieCanvas — TieCanvas는 정사각을 강제하므로 절대 배치로 덮는다. */
function Fill({ children }: { children: ReactNode }) {
  return (
    <Box position="relative" minHeight={0}>
      <Box position="absolute" inset={0}>
        {children}
      </Box>
    </Box>
  );
}

const FABRIC_ZOOM = 2;

/** 샷 한 장짜리 카드 — 컷마다 따로 둥글린 회색 칸. */
function ShotCard({ children }: { children: ReactNode }) {
  return (
    <Box
      position="relative"
      minHeight={0}
      overflow="hidden"
      bg="bg.neutral-weak"
      borderRadius="r3"
    >
      <Box position="absolute" inset={0}>
        {children}
      </Box>
    </Box>
  );
}

/**
 * 사진 구성 — 왼쪽은 칸을 꽉 채운 전체 샷, 오른쪽은 평평한 원단(무늬 반복). 넥타이 크롭이 아니라
 * 잘린 그림으로 읽히지 않는다. 포인트가 있으면 오른쪽을 둘로 나눠 상단이면 매듭 확대를 위에,
 * 하단이면 아래 끝 확대를 아래에 둔다(원단은 그 반대편). 컷마다 별도 카드다.
 * 넥타이는 매듭 없는 평면 컷(`silhouette="flat"`) — 매듭 있는 실사 컷은 상세(`TemplateDetailShots`)가 쓴다.
 * 실사 사진(`layout.photos`)이 있으면 전체 샷·원단 자리에 사진이 들어간다.
 * `cycle`(모바일)이면 나란히 두지 않고 한 칸에서 컷을 번갈아 보여준다(`CyclingShots`).
 */
export function TemplateShots({
  shot,
  layout,
  cycle = false,
}: {
  shot: TemplateShot;
  layout: TemplateLayout;
  cycle?: boolean;
}) {
  const { point, photos } = layout;
  const emblem = templateEmblem(layout);
  const full = photos?.full ? (
    <ImageFrame src={photos.full} alt={shot.alt} fill />
  ) : (
    // TieCanvas의 안쪽 여백을 상쇄해 넥타이를 칸에 꽉 채운다 — 기준점이 아래라 끝이 순환 점 표시에 닿지 않는다.
    <Box
      position="absolute"
      inset={0}
      style={{ transform: "scale(1.12)", transformOrigin: "50% 60%" }}
    >
      <TieCanvas {...shot} mode="tie" silhouette="flat" emblem={emblem} />
    </Box>
  );
  const fabric = photos?.detail ? (
    <ImageFrame src={photos.detail} alt={`${shot.alt}, 원단`} fill />
  ) : (
    // 원단은 무늬를 크게 — 타일을 키워 실 결이 보이게 한다.
    <TieCanvas
      {...shot}
      alt={`${shot.alt}, 원단`}
      mode="repeat"
      tileScale={shot.tileScale * FABRIC_ZOOM}
    />
  );
  const pointShot =
    point === "none" ? null : (
      <TieCanvas
        {...shot}
        mode="tie"
        silhouette="flat"
        focus={point === "top" ? "knot" : "tip"}
        emblem={emblem}
      />
    );

  if (cycle) {
    return (
      <CyclingShots
        shots={pointShot ? [full, pointShot, fabric] : [full, fabric]}
      />
    );
  }

  const right = pointShot ? (
    <Grid
      templateColumns="1fr"
      gap="x3"
      style={{ gridTemplateRows: "1fr 1fr" }}
    >
      {point === "top" ? (
        <>
          <ShotCard>{pointShot}</ShotCard>
          <ShotCard>{fabric}</ShotCard>
        </>
      ) : (
        <>
          <ShotCard>{fabric}</ShotCard>
          <ShotCard>{pointShot}</ShotCard>
        </>
      )}
    </Grid>
  ) : (
    <ShotCard>{fabric}</ShotCard>
  );
  return (
    <Grid
      templateColumns="1fr 1fr"
      gap="x3"
      width="full"
      style={{ aspectRatio: "6 / 5" }}
    >
      <ShotCard>{full}</ShotCard>
      {right}
    </Grid>
  );
}

const CYCLE_MS = 3000;

/**
 * 한 칸에서 컷을 크로스페이드로 번갈아 보여준다 — 화면 가운데 띠에 들어온 행만 돌아서 목록에서
 * 동시에 하나만 움직인다. 동작 줄이기 설정이면 첫 컷(전체 샷)에 멈춘다.
 */
function CyclingShots({ shots }: { shots: ReactNode[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [inView, setInView] = useState(false);
  const count = shots.length;

  useEffect(() => {
    const el = ref.current;
    // jsdom(테스트)에는 IntersectionObserver가 없다 — 없으면 돌리지 않는다.
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? false),
      { rootMargin: "-35% 0px -35% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % count), CYCLE_MS);
    return () => clearInterval(id);
  }, [inView, count]);

  return (
    <Box
      ref={ref}
      position="relative"
      width="full"
      overflow="hidden"
      bg="bg.neutral-weak"
      borderRadius="r3"
      style={{ aspectRatio: "4 / 5" }}
    >
      {shots.map((content, i) => (
        <Box
          key={i}
          position="absolute"
          inset={0}
          aria-hidden={i !== index || undefined}
          className="transition-opacity duration-(--duration-slow) ease-standard"
          style={{ opacity: i === index ? 1 : 0 }}
        >
          {content}
        </Box>
      ))}
      <Float placement="bottom-center" offsetY="x3">
        <HStack gap="x1_5" aria-hidden>
          {shots.map((_, i) => (
            <Box
              key={i}
              width={6}
              height={6}
              borderRadius="full"
              bg={i === index ? "bg.neutral-solid" : "bg.neutral-weak-pressed"}
            />
          ))}
        </HStack>
      </Float>
    </Box>
  );
}

/** 무늬 확대 한 장(2:1) — 모바일 색 고르기에서 칩 바로 아래에 두는 작은 미리보기. */
export function TemplatePatternShot({ shot }: { shot: TemplateShot }) {
  return (
    <Box
      position="relative"
      width="full"
      bg="bg.neutral-weak"
      borderRadius="r3"
      overflow="hidden"
      style={{ aspectRatio: "2 / 1" }}
    >
      <Box position="absolute" inset={0}>
        <TieCanvas {...shot} mode="tie" focus="blade" />
      </Box>
    </Box>
  );
}

/**
 * 상세용 구성 — 전체 샷을 4:5로 크게, 아래에 확대 샷을 가로로 나란히(무늬 확대 + 포인트
 * 확대). 올패턴은 무늬 확대 한 장이 가로로 넓게 들어간다.
 */
export function TemplateDetailShots({
  shot,
  layout,
}: {
  shot: TemplateShot;
  layout: TemplateLayout;
}) {
  const { point, photos } = layout;
  const emblem = templateEmblem(layout);
  return (
    <VStack
      alignItems="stretch"
      gap="x0_5"
      bg="bg.neutral-weak"
      borderRadius="r3"
      overflow="hidden"
    >
      <Box width="full" position="relative" style={{ aspectRatio: "4 / 5" }}>
        <Box position="absolute" inset={0}>
          {photos?.full ? (
            <ImageFrame src={photos.full} alt={shot.alt} fill />
          ) : (
            <TieCanvas {...shot} mode="tie" emblem={emblem} />
          )}
        </Box>
      </Box>
      <Grid
        templateColumns={point === "none" ? "1fr" : "1fr 1fr"}
        gap="x0_5"
        style={{ aspectRatio: "2 / 1" }}
      >
        {point === "top" ? (
          <Fill>
            <TieCanvas {...shot} mode="tie" focus="knot" emblem={emblem} />
          </Fill>
        ) : null}
        <Fill>
          {photos?.detail ? (
            <ImageFrame
              src={photos.detail}
              alt={`${shot.alt}, 무늬 확대`}
              fill
            />
          ) : (
            <TieCanvas {...shot} mode="tie" focus="blade" />
          )}
        </Fill>
        {point === "bottom" ? (
          <Fill>
            <TieCanvas {...shot} mode="tie" focus="tip" emblem={emblem} />
          </Fill>
        ) : null}
      </Grid>
    </VStack>
  );
}

import type { DesignExampleOut, DesignSessionOut } from "@essesion/api-client";
import {
  Box,
  Grid,
  HStack,
  ImageFrame,
  Text,
  TieCanvas,
  VStack,
} from "@essesion/shared";
import type { ReactNode } from "react";

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

/**
 * 사진 구성 — 왼쪽은 전체 샷(1:2), 오른쪽은 기본 무늬 확대. 포인트가 있으면 오른쪽을
 * 둘로 나눠 상단이면 매듭 확대를 위에, 하단이면 아래 끝 확대를 아래에 둔다(무늬 확대는
 * 그 반대편). 올패턴은 오른쪽이 무늬 확대 한 장이다. 묶음은 정사각이다.
 * 실사 사진(`layout.photos`)이 있으면 전체 샷·무늬 확대 자리에 사진이 들어간다.
 */
export function TemplateShots({
  shot,
  layout,
}: {
  shot: TemplateShot;
  layout: TemplateLayout;
}) {
  const { point, photos } = layout;
  const emblem = templateEmblem(layout);
  // 기본 무늬 확대에는 로고를 넣지 않는다 — 블레이드 중간 크롭이라 로고가 잘려 걸린다.
  const pattern = (
    <Fill>
      {photos?.detail ? (
        <ImageFrame src={photos.detail} alt={`${shot.alt}, 무늬 확대`} fill />
      ) : (
        <TieCanvas {...shot} mode="tie" focus="blade" />
      )}
    </Fill>
  );
  const right =
    point === "none" ? (
      pattern
    ) : (
      <Grid
        templateColumns="1fr"
        gap="x0_5"
        style={{ gridTemplateRows: "1fr 1fr" }}
      >
        {point === "top" ? (
          <>
            <Box minHeight={0}>
              <TieCanvas {...shot} mode="tie" focus="knot" emblem={emblem} />
            </Box>
            {pattern}
          </>
        ) : (
          <>
            {pattern}
            <Box minHeight={0}>
              <TieCanvas {...shot} mode="tie" focus="tip" emblem={emblem} />
            </Box>
          </>
        )}
      </Grid>
    );
  return (
    <Grid
      templateColumns="1fr 1fr"
      gap="x0_5"
      width="full"
      style={{ aspectRatio: 1 }}
    >
      <Fill>
        {photos?.full ? (
          <ImageFrame src={photos.full} alt={shot.alt} fill />
        ) : (
          <TieCanvas {...shot} mode="tie" emblem={emblem} />
        )}
      </Fill>
      {right}
    </Grid>
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

import type { DesignExampleOut, DesignSessionOut } from "@essesion/api-client";
import { Box, Grid, TieCanvas, VStack } from "@essesion/shared";
import type { ReactNode } from "react";

/**
 * 템플릿의 포인트 위치 — 사진 구성을 정한다. 전체 샷과 기본 무늬 확대는 공통이고,
 * 포인트(로고 자리)가 상단이면 매듭 확대, 하단이면 아래 끝 확대를 더한다. 올패턴은 추가 없음.
 */
export type TemplatePoint = DesignExampleOut["point"];

/**
 * 샷 구성에 필요한 템플릿 데이터 — 포인트 위치, 포인트 자리의 엠블럼(`<symbol>`).
 * 템플릿 페이지는 `templateLayout`, 세션 페이지(색·로고)는 `sessionLayout`으로 만든다.
 */
export type TemplateLayout = {
  point: TemplatePoint;
  emblemSvg: string | null;
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
  };
}

/**
 * 세션은 시작한 템플릿(`example_id`)의 포인트 위치를 쓰고, 엠블럼은 로고 슬롯에 지금 들어 있는
 * 모티프(로고를 넣은 뒤면 로고)다.
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
 * 템플릿 목록 카드의 사진 — 매듭 없는 평면 넥타이(`silhouette="flat"`) 한 장, 4:5 회색 칸.
 * 포인트 템플릿이면 그 자리(매듭·끝)에 엠블럼을 얹는다.
 */
export function TemplateTieShot({
  shot,
  layout,
}: {
  shot: TemplateShot;
  layout: TemplateLayout;
}) {
  return (
    <Box
      position="relative"
      width="full"
      overflow="hidden"
      bg="bg.neutral-weak"
      borderRadius="r3"
      style={{ aspectRatio: "4 / 5" }}
    >
      {/* TieCanvas의 안쪽 여백을 상쇄해 넥타이를 칸에 꽉 채운다. */}
      <Box
        position="absolute"
        inset={0}
        style={{ transform: "scale(1.12)", transformOrigin: "50% 60%" }}
      >
        <TieCanvas
          {...shot}
          mode="tie"
          silhouette="flat"
          emblem={templateEmblem(layout)}
        />
      </Box>
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
  const { point } = layout;
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
          <TieCanvas {...shot} mode="tie" emblem={emblem} />
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
          <TieCanvas {...shot} mode="tie" focus="blade" />
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

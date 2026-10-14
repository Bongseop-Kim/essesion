import type { DesignSessionOut } from "@essesion/api-client";
import {
  ActionButton,
  Box,
  ContentPlaceholder,
  HStack,
  Skeleton,
  snackbar,
  Text,
  useBreakpoint,
  VStack,
} from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { designErrorMessage } from "@/features/design/model/errors";
import { designSessionQueryOptions } from "@/features/design/model/queries";
import {
  svgTileScale,
  svgToDataUri,
} from "@/features/design/model/svg-preview";
import { useApplyColorway } from "@/features/design/model/use-steps";
import {
  sessionLayout,
  TemplateDetailShots,
  TemplatePatternShot,
  type TemplateShot,
} from "@/features/design/ui/template-shots";
import { logoPath } from "@/pages/design/logo";
import { designExamplesQueryOptions } from "@/shared/lib/live-queries";
import { useSession } from "@/shared/store/session";
import { ContentLayout } from "@/shared/ui/content-layout";

export function colorPath(sessionId: string) {
  return `/design/sessions/${sessionId}/color`;
}

const CRUMBS = [
  { label: "홈", href: "/" },
  { label: "디자인", href: "/design" },
  { label: "색 고르기" },
];

type Colorway = { id: string; name: string; mapping: Record<string, string> };

/** 세션 intent의 colorways — 엔진 명세(worker-engine.md)대로 id·mapping만 믿는다. */
function readColorways(intent: DesignSessionOut["current_intent"]): Colorway[] {
  const raw = intent?.colorways;
  if (!Array.isArray(raw)) return [];
  const out: Colorway[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { id, name, mapping } = item as Record<string, unknown>;
    if (typeof id !== "string" || typeof mapping !== "object" || !mapping)
      continue;
    out.push({
      id,
      name: typeof name === "string" && id !== "default" ? name : "기본",
      mapping: mapping as Record<string, string>,
    });
  }
  return out;
}

/**
 * 화면 미리보기용 색 치환 — 현재 colorway의 hex를 고른 colorway의 hex로 한 번에 바꾼다.
 * 정본은 서버 재렌더(다음 버튼)가 만든다. 같은 hex를 두 슬롯이 쓰면 둘 다 바뀐다(임시 프리셋 한계).
 */
function recolorSvg(svg: string, from: Colorway, to: Colorway): string {
  const table = new Map<string, string>();
  for (const [slot, hex] of Object.entries(from.mapping)) {
    const next = to.mapping[slot];
    if (next && next.toLowerCase() !== hex.toLowerCase())
      table.set(hex.toLowerCase(), next);
  }
  if (table.size === 0) return svg;
  return svg.replace(
    /#[0-9a-f]{6}\b/gi,
    (hex) => table.get(hex.toLowerCase()) ?? hex,
  );
}

/** 색 선택 — 템플릿에 미리 정한 프리셋 중 하나를 고른다. 화면은 즉시, 서버는 다음에서. */
export function DesignColorPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const authenticated = useSession((state) => state.status === "authenticated");
  const sessionQuery = useQuery(
    designSessionQueryOptions({ sessionId: id, authenticated }),
  );
  const apply = useApplyColorway();
  const examplesQuery = useQuery(designExamplesQueryOptions());
  const bp = useBreakpoint();
  const isDesktop = bp === "lg" || bp === "xl";
  const [picked, setPicked] = useState<string | null>(null);

  const session = sessionQuery.data;
  const colorways = useMemo(
    () => readColorways(session?.current_intent ?? null),
    [session?.current_intent],
  );
  const currentId = session?.colorway ?? "default";
  const selectedId = picked ?? currentId;
  const current = colorways.find((c) => c.id === currentId);
  const selected = colorways.find((c) => c.id === selectedId);
  const baseSvg = session?.preview_svg ?? null;
  const svg =
    baseSvg && current && selected && current.id !== selected.id
      ? recolorSvg(baseSvg, current, selected)
      : baseSvg;

  const next = async () => {
    if (!session) return;
    try {
      if (selectedId !== currentId) {
        await apply.mutateAsync({
          sessionId: session.id,
          colorwayId: selectedId,
        });
      }
      navigate(logoPath(session.id));
    } catch (error) {
      snackbar(designErrorMessage(error, "색을 바꾸지 못했습니다."));
    }
  };

  if (sessionQuery.isPending) {
    return (
      <ContentLayout
        breadcrumbs={CRUMBS}
        sidebar={
          <VStack alignItems="stretch" gap="x3" aria-busy>
            <Skeleton preset="title" />
            <Skeleton preset="line" />
          </VStack>
        }
      >
        <Box width="full" style={{ aspectRatio: "4 / 5" }}>
          <Skeleton width="full" height="full" radius="r4" />
        </Box>
      </ContentLayout>
    );
  }

  if (!session || !svg) {
    return (
      <ContentLayout breadcrumbs={CRUMBS}>
        <ContentPlaceholder
          title="디자인을 불러오지 못했어요"
          description="템플릿을 다시 골라 주세요."
          action={
            <ActionButton
              variant="neutralWeak"
              size="small"
              onClick={() => navigate("/design")}
            >
              템플릿 목록으로
            </ActionButton>
          }
        />
      </ContentLayout>
    );
  }

  const shot: TemplateShot = {
    imageSrc: svgToDataUri(svg),
    alt: `${selected?.name ?? "기본"} 색 미리보기`,
    tileScale: svgTileScale(svg),
    surface: "none",
  };

  return (
    <>
      <title>색 고르기 | 영선산업</title>
      <meta name="robots" content="noindex, nofollow" />
      <ContentLayout
        breadcrumbs={CRUMBS}
        sidebarFirst
        sidebar={
          <VStack alignItems="stretch" gap="x5">
            <VStack alignItems="start" gap="x1">
              <Text textStyle="caption" color="fg.neutral-muted">
                1 / 2 단계
              </Text>
              <Text as="h1" textStyle="title1">
                색 고르기
              </Text>
              <Text textStyle="body" color="fg.neutral-muted">
                이 템플릿에 맞춰 둔 실 색 조합이에요. 골라서 바로 비교해 보세요.
              </Text>
            </VStack>
            <ColorwayPicker
              colorways={colorways}
              value={selectedId}
              onChange={setPicked}
              disabled={apply.isPending}
            />
            {/* 모바일은 칩이 위라 고른 결과가 바로 보이게 작은 무늬 확대를 칩 아래에 둔다. 큰 샷은 본문. */}
            {isDesktop ? null : <TemplatePatternShot shot={shot} />}
          </VStack>
        }
        actionBar={
          <ActionButton
            variant="brandSolid"
            size="large"
            className="w-full"
            loading={apply.isPending}
            onClick={() => void next()}
          >
            다음 · 로고 올리기
          </ActionButton>
        }
      >
        <TemplateDetailShots
          shot={shot}
          layout={sessionLayout(
            session,
            examplesQuery.data?.find((t) => t.id === session.example_id),
          )}
        />
      </ContentLayout>
    </>
  );
}

/** 프리셋 라디오 — 바탕·무늬 두 색을 반반 칠한 동그라미와 실 색 이름. */
function ColorwayPicker({
  colorways,
  value,
  onChange,
  disabled,
}: {
  colorways: readonly Colorway[];
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <HStack
      as="div"
      role="radiogroup"
      aria-label="실 색 조합"
      gap="x3"
      flexWrap="wrap"
      alignItems="start"
    >
      {colorways.map((colorway) => {
        const colors = Object.values(colorway.mapping);
        const [bg, accent = bg] = colors;
        const checked = colorway.id === value;
        return (
          <VStack
            key={colorway.id}
            as="button"
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={colorway.name}
            disabled={disabled}
            onClick={() => onChange(colorway.id)}
            alignItems="center"
            gap="x1_5"
            width={64}
            className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring disabled:pointer-events-none disabled:opacity-50"
          >
            <Box
              width={44}
              height={44}
              borderRadius="full"
              borderWidth={checked ? 2 : 1}
              borderColor={checked ? "stroke.neutral" : "stroke.neutral-weak"}
              style={{
                background: `linear-gradient(135deg, ${bg} 50%, ${accent} 50%)`,
              }}
            />
            <Text
              as="span"
              textStyle="captionSm"
              color={checked ? "fg.neutral" : "fg.neutral-muted"}
              maxLines={2}
              className="text-center"
            >
              {colorway.name}
            </Text>
          </VStack>
        );
      })}
    </HStack>
  );
}

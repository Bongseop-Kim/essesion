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

// ponytail: 임시 실 색 표 — 정식 실 색 데이터가 오면 이 표를 그 값으로 바꾼다. 서버는 hex 형식만 본다.
const YARN: readonly { name: string; hex: string }[] = [
  { name: "네이비", hex: "#1B2A49" }, // harness-ignore: 실 색 데이터(제품 값, UI 토큰 아님)
  { name: "블랙", hex: "#141414" }, // harness-ignore: 실 색 데이터(제품 값, UI 토큰 아님)
  { name: "버건디", hex: "#6B1F2A" }, // harness-ignore: 실 색 데이터(제품 값, UI 토큰 아님)
  { name: "포레스트", hex: "#1F3D2B" }, // harness-ignore: 실 색 데이터(제품 값, UI 토큰 아님)
  { name: "차콜", hex: "#3A3A3C" }, // harness-ignore: 실 색 데이터(제품 값, UI 토큰 아님)
  { name: "골드", hex: "#C9A24B" }, // harness-ignore: 실 색 데이터(제품 값, UI 토큰 아님)
  { name: "실버", hex: "#B8BCC2" }, // harness-ignore: 실 색 데이터(제품 값, UI 토큰 아님)
  { name: "아이보리", hex: "#EFE9DC" }, // harness-ignore: 실 색 데이터(제품 값, UI 토큰 아님)
  { name: "베이지", hex: "#CBB79A" }, // harness-ignore: 실 색 데이터(제품 값, UI 토큰 아님)
  { name: "스카이", hex: "#7FA8D6" }, // harness-ignore: 실 색 데이터(제품 값, UI 토큰 아님)
];

type Part = { slot: string; name: string };

/** 고를 수 있는 부위 — 팔레트에서 이름(`name`)이 붙은 슬롯. 템플릿 시드가 정한다. */
function readParts(intent: DesignSessionOut["current_intent"]): Part[] {
  const slots = (intent?.palette as { slots?: unknown } | undefined)?.slots;
  if (!Array.isArray(slots)) return [];
  return slots.flatMap((slot) => {
    const { id, name } = (slot ?? {}) as Record<string, unknown>;
    return typeof id === "string" && typeof name === "string" && name
      ? [{ slot: id, name }]
      : [];
  });
}

/** 지금 적용된 colorway의 슬롯→색 — 엔진 명세(worker-engine.md)대로 id·mapping만 믿는다. */
function readMapping(
  intent: DesignSessionOut["current_intent"],
  colorwayId: string,
): Record<string, string> {
  const raw = intent?.colorways;
  if (!Array.isArray(raw)) return {};
  const found = raw.find(
    (item) => (item as { id?: unknown } | null)?.id === colorwayId,
  ) as { mapping?: unknown } | undefined;
  return typeof found?.mapping === "object" && found.mapping
    ? (found.mapping as Record<string, string>)
    : {};
}

/**
 * 화면 미리보기용 색 치환 — 지금 색의 hex를 고른 hex로 한 번에 바꾼다.
 * 정본은 서버 재렌더(다음 버튼)가 만든다. 같은 hex를 두 슬롯이 쓰면 둘 다 바뀐다(미리보기 한계).
 */
function recolorSvg(
  svg: string,
  from: Record<string, string>,
  picked: Record<string, string>,
): string {
  const table = new Map<string, string>();
  for (const [slot, next] of Object.entries(picked)) {
    const hex = from[slot];
    if (hex && hex.toLowerCase() !== next.toLowerCase())
      table.set(hex.toLowerCase(), next);
  }
  if (table.size === 0) return svg;
  return svg.replace(
    /#[0-9a-f]{6}\b/gi,
    (hex) => table.get(hex.toLowerCase()) ?? hex,
  );
}

function yarnName(hex: string | undefined) {
  return (
    YARN.find((yarn) => yarn.hex.toLowerCase() === hex?.toLowerCase())?.name ??
    "기본"
  );
}

/** 색 선택 — 템플릿이 정한 부위마다 실 색을 고른다. 화면은 즉시, 서버는 다음에서. */
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
  const [picked, setPicked] = useState<Record<string, string>>({});

  const session = sessionQuery.data;
  const intent = session?.current_intent ?? null;
  const parts = useMemo(() => readParts(intent), [intent]);
  const current = useMemo(
    () => readMapping(intent, session?.colorway ?? "default"),
    [intent, session?.colorway],
  );
  const changed = Object.entries(picked).filter(
    ([slot, hex]) => current[slot]?.toLowerCase() !== hex.toLowerCase(),
  );
  const baseSvg = session?.preview_svg ?? null;
  const svg = baseSvg && recolorSvg(baseSvg, current, picked);
  // 배치형(panel)도 같은 슬롯 색을 쓴다 — 고른 색을 같이 입힌다.
  const panelSvg =
    session?.preview_panel_svg &&
    recolorSvg(session.preview_panel_svg, current, picked);

  const next = async () => {
    if (!session) return;
    try {
      if (changed.length > 0) {
        await apply.mutateAsync({
          sessionId: session.id,
          colors: Object.fromEntries(changed),
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
    panelSrc: panelSvg ? svgToDataUri(panelSvg) : undefined,
    alt: "고른 색 미리보기",
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
                부위마다 실 색을 골라 보세요. 고르면 바로 미리 보여 드려요.
              </Text>
            </VStack>
            {parts.map((part) => (
              <YarnPicker
                key={part.slot}
                part={part}
                value={picked[part.slot] ?? current[part.slot]}
                onChange={(hex) =>
                  setPicked((prev) => ({ ...prev, [part.slot]: hex }))
                }
                disabled={apply.isPending}
              />
            ))}
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

/** 부위 하나의 실 색 라디오 — "바탕 · 네이비" 제목 아래 실 색 동그라미. */
function YarnPicker({
  part,
  value,
  onChange,
  disabled,
}: {
  part: Part;
  value: string | undefined;
  onChange: (hex: string) => void;
  disabled: boolean;
}) {
  return (
    <VStack alignItems="stretch" gap="x2">
      <Text as="span" textStyle="labelSm">
        {part.name}
        <Text as="span" textStyle="labelSm" color="fg.neutral-muted">
          {` · ${yarnName(value)}`}
        </Text>
      </Text>
      <HStack
        as="div"
        role="radiogroup"
        aria-label={`${part.name} 실 색`}
        gap="x2"
        flexWrap="wrap"
      >
        {YARN.map((yarn) => {
          const checked = yarn.hex.toLowerCase() === value?.toLowerCase();
          return (
            <Box
              key={yarn.hex}
              as="button"
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={yarn.name}
              disabled={disabled}
              onClick={() => onChange(yarn.hex)}
              width={36}
              height={36}
              borderRadius="full"
              borderWidth={checked ? 2 : 1}
              borderColor={checked ? "stroke.neutral" : "stroke.neutral-weak"}
              className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring disabled:pointer-events-none disabled:opacity-50"
              style={{
                background: yarn.hex,
                boxShadow: checked
                  ? "inset 0 0 0 2px var(--color-bg-layer-default)"
                  : undefined,
              }}
            />
          );
        })}
      </HStack>
    </VStack>
  );
}

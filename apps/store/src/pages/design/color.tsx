import type { DesignSessionOut } from "@essesion/api-client";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  ActionButton,
  AttachmentDisplayField,
  Box,
  Chip,
  ContentPlaceholder,
  Grid,
  HStack,
  Icon,
  Skeleton,
  snackbar,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { EyeDropperIcon } from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { type ChangeEvent, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";

import {
  DESIGN_PHOTO_ACCEPT,
  DESIGN_SVG_ACCEPT,
  readDesignMotifSvg,
  uploadDesignPhoto,
} from "@/features/design/api/attachments";
import { previewPhotoMotif } from "@/features/design/api/context-tools";
import { designErrorMessage } from "@/features/design/model/errors";
import { designSessionQueryOptions } from "@/features/design/model/queries";
import {
  svgTileScale,
  svgToDataUri,
} from "@/features/design/model/svg-preview";
import { useFinalizeFlow } from "@/features/design/model/use-design-output";
import {
  useApplyColorway,
  usePlaceLogo,
} from "@/features/design/model/use-steps";
import {
  sessionLayout,
  TemplateKnotShot,
  type TemplateShot,
  TemplateTieShot,
  TemplateWornShot,
} from "@/features/design/ui/template-shots";
import { resultPath } from "@/pages/design/result";
import {
  designExamplesQueryOptions,
  tokenBalanceQueryOptions,
} from "@/shared/lib/live-queries";
import { useSession } from "@/shared/store/session";
import { ContentLayout } from "@/shared/ui/content-layout";

export function colorPath(sessionId: string) {
  return `/design/sessions/${sessionId}/color`;
}

const CRUMBS = [
  { label: "홈", href: "/" },
  { label: "디자인", href: "/design" },
  { label: "색·로고" },
];

type Logo = {
  id: string;
  name: string;
  /** 원본 미리보기(objectURL) — 화면에는 항상 올린 그대로를 보여준다 */
  sourceUrl: string;
  /** 서버가 정리한 SVG — 통과 표시. 없으면 확인 중이거나 미통과 */
  svg: string | null;
};

const HEX = /^#?[0-9a-f]{6}$/i;

function hslHex(h: number, s: number, l: number) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

/** 색 계열 견본 — 계열마다 색조 두 줄 × 밝기 8단계. 색은 제한 없다(직접 고르기·색 코드). */
const FAMILY_HUES: { name: string; hues: [number, number][] }[] = [
  {
    name: "뉴트럴",
    hues: [
      [40, 5],
      [30, 22],
    ],
  },
  {
    name: "블루",
    hues: [
      [215, 55],
      [200, 55],
    ],
  },
  {
    name: "그린",
    hues: [
      [145, 45],
      [90, 45],
    ],
  },
  {
    name: "레드·핑크",
    hues: [
      [355, 55],
      [335, 55],
    ],
  },
  {
    name: "옐로·브라운",
    hues: [
      [42, 55],
      [25, 55],
    ],
  },
  {
    name: "퍼플",
    hues: [
      [265, 45],
      [290, 45],
    ],
  },
];
const FAMILIES = FAMILY_HUES.map(({ name, hues }) => ({
  name,
  swatches: hues.flatMap(([h, s]) =>
    [14, 24, 34, 46, 58, 70, 82, 92].map((l) => hslHex(h, s, l)),
  ),
}));

function rgb(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255] as const;
}

/** 지금 색에 가장 가까운 견본이 있는 계열 — 부위를 펼칠 때 처음 보여 줄 계열. */
function nearestFamily(hex: string | undefined) {
  if (!hex || !HEX.test(hex)) return 0;
  const [r, g, b] = rgb(hex);
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  FAMILIES.forEach((family, index) => {
    for (const swatch of family.swatches) {
      const [sr, sg, sb] = rgb(swatch);
      const distance = (r - sr) ** 2 + (g - sg) ** 2 + (b - sb) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
  });
  return best;
}

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

type Colorway = { id: string; name?: string; mapping: Record<string, string> };

function readColorways(intent: DesignSessionOut["current_intent"]) {
  const raw = intent?.colorways;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is Colorway =>
      typeof (item as { id?: unknown } | null)?.id === "string" &&
      typeof (item as { mapping?: unknown }).mapping === "object" &&
      (item as { mapping?: unknown }).mapping !== null,
  );
}

/** 추천 배색 — 시드가 이름 붙여 둔 colorway(`default`·직접 고른 색 제외). */
function readPresets(intent: DesignSessionOut["current_intent"]) {
  return readColorways(intent).filter(
    (cw): cw is Colorway & { name: string } =>
      cw.id !== "default" && typeof cw.name === "string" && cw.name !== "",
  );
}

/**
 * 화면 미리보기용 색 치환 — 지금 색의 hex를 고른 hex로 한 번에 바꾼다.
 * 정본은 서버 재렌더(생성 버튼)가 만든다. 같은 hex를 두 슬롯이 쓰면 둘 다 바뀐다(미리보기 한계).
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

function sameHex(a: string | undefined, b: string | undefined) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/**
 * 색·로고 — 템플릿이 정한 부위마다 색을 고르고(화면은 즉시) 로고를 올린다. 로고는 사진이면 배경을
 * 지우고 벡터로 바꾸고, SVG면 그대로 쓴다. 썸네일은 올린 원본을 그대로 두고 통과/미통과만 알린다.
 * "생성"은 바꾼 색 적용(무료) → 로고를 템플릿 슬롯에 넣기(무료) → 실사화(토큰) 순서로 돌려 결과로 간다.
 */
export function DesignColorPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const authenticated = useSession((state) => state.status === "authenticated");
  const sessionQuery = useQuery(
    designSessionQueryOptions({ sessionId: id, authenticated }),
  );
  const apply = useApplyColorway();
  const place = usePlaceLogo();
  const balanceQuery = useQuery(tokenBalanceQueryOptions(authenticated));
  const finalize = useFinalizeFlow({
    sessionId: id,
    onDone: (job) => navigate(resultPath(id), { state: { job } }),
  });
  const examplesQuery = useQuery(designExamplesQueryOptions());
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [view, setView] = useState("worn");
  const [logo, setLogo] = useState<Logo | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  const session = sessionQuery.data;
  const intent = session?.current_intent ?? null;
  const parts = useMemo(() => readParts(intent), [intent]);
  const presets = useMemo(() => readPresets(intent), [intent]);
  const current = useMemo(
    () =>
      readColorways(intent).find(
        (cw) => cw.id === (session?.colorway ?? "default"),
      )?.mapping ?? {},
    [intent, session?.colorway],
  );
  const value = (slot: string) => picked[slot] ?? current[slot];
  const changed = Object.entries(picked).filter(
    ([slot, hex]) => !sameHex(current[slot], hex),
  );
  const baseSvg = session?.preview_svg ?? null;
  const svg = baseSvg && recolorSvg(baseSvg, current, picked);
  // 배치형(panel)도 같은 슬롯 색을 쓴다 — 고른 색을 같이 입힌다.
  const panelSvg =
    session?.preview_panel_svg &&
    recolorSvg(session.preview_panel_svg, current, picked);

  const busy = preparing || placing || finalize.loading;
  const cost = balanceQuery.data?.finalize_cost ?? null;

  const addFile = async (file: File) => {
    const sourceUrl = URL.createObjectURL(file);
    const name = file.name.replace(/\.[^.]+$/, "") || "로고";
    setLogo({ id: sourceUrl, name, sourceUrl, svg: null });
    setLogoError(null);
    setPreparing(true);
    try {
      const isSvg =
        file.type === "image/svg+xml" ||
        file.name.toLocaleLowerCase().endsWith(".svg");
      const nextSvg = isSvg
        ? await readDesignMotifSvg(file)
        : (await previewPhotoMotif({ uploadId: await uploadDesignPhoto(file) }))
            .svg;
      setLogo((current) =>
        current?.id === sourceUrl ? { ...current, svg: nextSvg } : current,
      );
    } catch (cause) {
      setLogoError(
        `미통과 · ${designErrorMessage(cause, "로고를 읽지 못했습니다.")}`,
      );
    } finally {
      setPreparing(false);
    }
  };

  const generate = async () => {
    if (!session || !logo?.svg || busy) return;
    setPlacing(true);
    try {
      if (changed.length > 0) {
        await apply.mutateAsync({
          sessionId: session.id,
          colors: Object.fromEntries(changed),
        });
        setPicked({});
      }
      await place.mutateAsync({
        sessionId: session.id,
        name: logo.name,
        svg: logo.svg,
      });
    } catch (cause) {
      snackbar(designErrorMessage(cause, "디자인을 반영하지 못했습니다."));
      setPlacing(false);
      return;
    }
    setPlacing(false);
    finalize.submit({ productionMethod: "print", weave: "twill-45", dpi: 300 });
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
  const layout = sessionLayout(
    session,
    examplesQuery.data?.find((t) => t.id === session.example_id),
  );

  return (
    <>
      <title>색·로고 | 영선산업</title>
      <meta name="robots" content="noindex, nofollow" />
      <ContentLayout
        breadcrumbs={CRUMBS}
        sidebar={
          <VStack alignItems="stretch" gap="x5">
            {/* 브레드크럼이 이미 말한다 — 제목은 화면에서 빼고 스크린리더용으로만 둔다. */}
            <Text as="h1" textStyle="title1" className="sr-only">
              색·로고
            </Text>
            <AttachmentDisplayField
              label="로고 파일"
              description="투명 배경(PNG·SVG)이나 한 가지 색 배경만 돼요. 사진·그라데이션 배경은 미통과예요."
              errorMessage={logoError}
              items={
                logo
                  ? [{ id: logo.id, alt: logo.name, src: logo.sourceUrl }]
                  : []
              }
              max={1}
              accept={`${DESIGN_PHOTO_ACCEPT},${DESIGN_SVG_ACCEPT}`}
              addLabel="로고 선택"
              onAddFiles={(files) => files[0] && void addFile(files[0])}
              onRemove={() => {
                setLogo(null);
                setLogoError(null);
              }}
            />
            {preparing ? (
              <Text
                textStyle="caption"
                color="fg.neutral-muted"
                aria-live="polite"
              >
                배경을 확인하고 있어요 · 10초쯤 걸려요
              </Text>
            ) : logo?.svg ? (
              <Text textStyle="caption" color="fg.positive" aria-live="polite">
                통과 · 배경 없는 로고로 확인했어요
              </Text>
            ) : null}
            {presets.length > 0 ? (
              <VStack alignItems="stretch" gap="x2">
                <Text as="span" textStyle="labelSm">
                  추천 배색
                </Text>
                <HStack gap="x2" flexWrap="wrap">
                  {presets.map((preset) => (
                    <Chip
                      key={preset.id}
                      size="small"
                      variant="outline"
                      disabled={busy}
                      selected={parts.every((part) =>
                        sameHex(value(part.slot), preset.mapping[part.slot]),
                      )}
                      onClick={() =>
                        setPicked(
                          Object.fromEntries(
                            parts.flatMap((part) => {
                              const hex = preset.mapping[part.slot];
                              return hex ? [[part.slot, hex] as const] : [];
                            }),
                          ),
                        )
                      }
                      prefix={
                        <HStack gap="x0_5" aria-hidden>
                          {parts.map((part) => (
                            <Box
                              key={part.slot}
                              width={14}
                              height={14}
                              borderRadius="full"
                              borderWidth={1}
                              borderColor="stroke.neutral-weak"
                              style={{
                                background: preset.mapping[part.slot],
                              }}
                            />
                          ))}
                        </HStack>
                      }
                    >
                      {preset.name}
                    </Chip>
                  ))}
                </HStack>
              </VStack>
            ) : null}
            <Accordion defaultValue={parts[0]?.slot}>
              {parts.map((part) => (
                <ColorPicker
                  key={part.slot}
                  part={part}
                  value={value(part.slot)}
                  onChange={(hex) =>
                    setPicked((prev) => ({ ...prev, [part.slot]: hex }))
                  }
                  disabled={busy}
                />
              ))}
            </Accordion>
          </VStack>
        }
        actionBar={
          <ActionButton
            variant="brandSolid"
            size="large"
            className="w-full"
            loading={placing || finalize.loading}
            disabled={!logo?.svg || busy}
            onClick={() => void generate()}
          >
            {cost !== null ? `생성 · ${cost}토큰` : "생성"}
          </ActionButton>
        }
      >
        <Grid templateColumns="72px minmax(0, 1fr)" gap="x3" alignItems="start">
          {/* 보기 전환 — 세 보기를 작은 그림으로 미리보기 왼쪽에 세로로 둔다. */}
          <VStack
            role="group"
            aria-label="미리보기 방식"
            alignItems="stretch"
            gap="x3"
          >
            {(
              [
                ["worn", "전체", TemplateWornShot, 1.8],
                ["flat", "대검", TemplateTieShot, 1],
                ["knot", "매듭", TemplateKnotShot, 1],
              ] as const
            ).map(([value, label, Thumb, zoom]) => (
              <VStack
                key={value}
                as="button"
                type="button"
                aria-pressed={view === value}
                onClick={() => setView(value)}
                alignItems="stretch"
                gap="x1_5"
                className="cursor-pointer rounded-r2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
              >
                <Box
                  borderRadius="r2"
                  overflow="hidden"
                  borderWidth={view === value ? 2 : 1}
                  borderColor={
                    view === value ? "stroke.neutral" : "stroke.neutral-weak"
                  }
                >
                  {/* TieCanvas 안쪽 여백(x6)은 고정 px라 72px 칸에선 넥타이가 작아진다 — 4배로 그려
                      줄이고, 전체는 깃·매듭 쪽을 더 키운다. */}
                  <Box
                    position="relative"
                    overflow="hidden"
                    style={{ aspectRatio: "4 / 5" }}
                  >
                    <Box
                      position="absolute"
                      top={0}
                      style={{
                        left: "-150%",
                        width: "400%",
                        transform: `scale(${0.25 * zoom})`,
                        transformOrigin: "50% 0",
                      }}
                    >
                      <Thumb shot={shot} layout={layout} />
                    </Box>
                  </Box>
                </Box>
                <Text
                  as="span"
                  textStyle={view === value ? "labelSm" : "caption"}
                  color={view === value ? "fg.neutral" : "fg.neutral-muted"}
                >
                  {label}
                </Text>
              </VStack>
            ))}
          </VStack>
          <Box minWidth={0}>
            {view === "flat" || view === "knot" ? (
              // 플랫·매듭은 칸을 꽉 채우면 PC에서 과하게 커진다 — 최대 폭을 두고 칸 높이는 플랫 넥타이에 맞춘다.
              // 매듭 컷은 그 높이를 위아래 여백 없이 꽉 채운다(깃이 위 끝, 넥타이가 아래 끝에서 잘린다).
              <Box
                position="relative"
                bg="bg.neutral-weak"
                borderRadius="r3"
                overflow="hidden"
                display="flex"
                justifyContent="center"
                py="x12"
              >
                <Box width="full" maxWidth={400}>
                  {view === "knot" ? (
                    <Box aria-hidden style={{ aspectRatio: "4 / 5" }} />
                  ) : (
                    <TemplateTieShot shot={shot} layout={layout} />
                  )}
                </Box>
                {view === "knot" ? (
                  <Box
                    position="absolute"
                    top={0}
                    bottom={0}
                    style={{
                      left: "50%",
                      transform: "translateX(-50%)",
                      aspectRatio: "4 / 5",
                    }}
                  >
                    <TemplateKnotShot shot={shot} layout={layout} />
                  </Box>
                ) : null}
              </Box>
            ) : (
              <TemplateWornShot shot={shot} layout={layout} />
            )}
          </Box>
        </Grid>
      </ContentLayout>
    </>
  );
}

/** 부위 하나 — 펼치면 색 계열 칩, 계열 견본, 직접 고르기·색 코드 입력. */
function ColorPicker({
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
  const [family, setFamily] = useState(() => nearestFamily(value));
  const [draft, setDraft] = useState<string | null>(null);
  const display = value?.toUpperCase() ?? "";

  return (
    <AccordionItem value={part.slot}>
      {/* 펼친 견본 위로 회색 띠가 생겨 거슬린다 — 이 화면은 호버 배경을 끈다. */}
      <AccordionTrigger className="hover:bg-transparent">
        <HStack gap="x3">
          <Box
            width={32}
            height={32}
            borderRadius="full"
            borderWidth={1}
            borderColor="stroke.neutral-weak"
            style={{ background: value }}
          />
          <VStack alignItems="start" gap="x0_5">
            <Text as="span" textStyle="label">
              {part.name}
            </Text>
            <Text as="span" textStyle="caption" color="fg.neutral-muted">
              {display}
            </Text>
          </VStack>
        </HStack>
      </AccordionTrigger>
      <AccordionContent>
        <VStack alignItems="stretch" gap="x3">
          <Grid columns={3} gap="x1_5">
            {FAMILIES.map((item, index) => (
              <Chip
                key={item.name}
                size="small"
                selected={index === family}
                onClick={() => setFamily(index)}
                className="justify-center"
                prefix={
                  <Box
                    width={10}
                    height={10}
                    borderRadius="full"
                    aria-hidden
                    style={{ background: item.swatches[3] }}
                  />
                }
              >
                {item.name}
              </Chip>
            ))}
          </Grid>
          <Grid
            role="radiogroup"
            aria-label={`${part.name} 색`}
            columns={8}
            gap="x1_5"
          >
            {FAMILIES[family]?.swatches.map((hex) => {
              const checked = sameHex(hex, value);
              return (
                <Box
                  key={hex}
                  as="button"
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-label={hex}
                  disabled={disabled}
                  onClick={() => onChange(hex)}
                  width="full"
                  borderRadius="r2"
                  borderWidth={checked ? 2 : 1}
                  borderColor={
                    checked ? "stroke.neutral" : "stroke.neutral-weak"
                  }
                  className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring disabled:pointer-events-none disabled:opacity-50"
                  style={{
                    aspectRatio: "1 / 1",
                    background: hex,
                    boxShadow: checked
                      ? "inset 0 0 0 2px var(--color-bg-layer-default)"
                      : undefined,
                  }}
                />
              );
            })}
          </Grid>
          <HStack gap="x2">
            <Box
              as="label"
              position="relative"
              width={44}
              height={44}
              borderRadius="r2"
              borderWidth={1}
              borderColor="stroke.neutral-weak"
              display="flex"
              alignItems="center"
              justifyContent="center"
              className="cursor-pointer"
            >
              <Icon svg={<EyeDropperIcon />} size={20} />
              <Box
                as="input"
                type="color"
                aria-label={`${part.name} 색 직접 고르기`}
                disabled={disabled}
                value={value?.toLowerCase()}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  onChange(event.target.value.toUpperCase())
                }
                position="absolute"
                inset={0}
                width="full"
                height="full"
                className="cursor-pointer"
                style={{ opacity: 0 }}
              />
            </Box>
            <Box flex={1}>
              <TextField
                aria-label={`${part.name} 색 코드`}
                prefix="색 코드"
                placeholder="#RRGGBB"
                maxLength={7}
                disabled={disabled}
                value={draft ?? display}
                onChange={(event) => {
                  const next = event.target.value.trim();
                  if (HEX.test(next)) {
                    onChange(
                      (next.startsWith("#") ? next : `#${next}`).toUpperCase(),
                    );
                    setDraft(null);
                  } else {
                    setDraft(next);
                  }
                }}
                onBlur={() => setDraft(null)}
              />
            </Box>
          </HStack>
        </VStack>
      </AccordionContent>
    </AccordionItem>
  );
}

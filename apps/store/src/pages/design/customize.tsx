import type { DesignLogoSlotOut, DesignSessionOut } from "@essesion/api-client";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  ActionButton,
  Box,
  Chip,
  ContentPlaceholder,
  Flex,
  Grid,
  HStack,
  Icon,
  ImageFrame,
  List,
  ListItem,
  Modal,
  ProgressCircle,
  ScrollFog,
  Skeleton,
  snackbar,
  Text,
  TextField,
  useBreakpoint,
  VStack,
} from "@essesion/shared";
import { EyeDropperIcon, PencilSquareIcon } from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import {
  type ChangeEvent,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  svgToPngFile,
} from "@/features/design/model/svg-preview";
import { usePlaceLogo } from "@/features/design/model/use-steps";
import {
  sessionLayout,
  TemplateKnotShot,
  TemplateKnotTallShot,
  type TemplateShot,
  TemplateTieShot,
  TemplateWornShot,
} from "@/features/design/ui/template-shots";
import { designExamplesQueryOptions } from "@/shared/lib/live-queries";
import { useSession } from "@/shared/store/session";
import { ContentLayout } from "@/shared/ui/content-layout";

export function customizePath(sessionId: string) {
  return `/design/sessions/${sessionId}/customize`;
}

const CRUMBS = [
  { label: "홈", href: "/" },
  { label: "디자인", href: "/design" },
  { label: "색·로고" },
];

type LogoSlot = DesignLogoSlotOut["slot"];

type Logo = {
  name: string;
  /** 원본 미리보기(objectURL) — 화면에는 항상 올린 그대로를 보여준다 */
  sourceUrl: string;
  /** checking: 배경 확인 → placing: 디자인에 넣는 중 → placed: 미리보기에 반영됨 */
  status: "checking" | "placing" | "placed" | "failed";
  error: string | null;
};

/** 템플릿이 없는 세션은 자리를 모른다 — slot 없이 보내면 서버 규칙 한 자리. */
const DEFAULT_LOGO_SLOTS: { slot?: LogoSlot; label?: string | null }[] = [{}];

const slotKey = (slot: LogoSlot | undefined) => String(slot ?? "default");

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

/** 색상 편집 버튼의 링 — 계열 대표색을 한 바퀴 두른다(색을 바꾸는 곳이라는 표시). */
const FAMILY_RING = `conic-gradient(${[...FAMILIES.slice(1), FAMILIES[1]]
  .map((family) => family?.swatches[4])
  .join(", ")})`;

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
 * 주문에는 이 결과를 PNG로 넘긴다. 같은 hex를 두 슬롯이 쓰면 둘 다 바뀐다(미리보기 한계).
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
 * "바로 주문하기"는 지금 미리보기 디자인을 PNG로 만들어 맞춤 주문의 참고 이미지로 넘긴다.
 */
export function DesignCustomizePage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const authenticated = useSession((state) => state.status === "authenticated");
  const sessionQuery = useQuery(
    designSessionQueryOptions({ sessionId: id, authenticated }),
  );
  const place = usePlaceLogo();
  const examplesQuery = useQuery(designExamplesQueryOptions());
  const [picked, setPicked] = useState<Record<string, string>>({});
  // 잉크 번짐 — 견본·추천 배색을 누를 때마다 오른다.
  const [ink, setInk] = useState(0);
  const [view, setView] = useState("worn");
  const swipeRef = useRef<HTMLDivElement>(null);
  // 로고 자리마다 마지막으로 올린 로고 — 통과하면 바로 그 자리에 넣어 미리보기가 바뀐다.
  const [logos, setLogos] = useState<Record<string, Logo>>({});
  const [uploading, setUploading] = useState(false);
  const [ordering, setOrdering] = useState(false);
  // 모바일 전용 — 색 시트 열림, 시트에서 고르는 부위
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetSlot, setSheetSlot] = useState<string | null>(null);
  // 숨긴 파일 입력 하나를 자리들이 같이 쓴다 — 고른 자리를 기억해 둔다.
  const fileRef = useRef<HTMLInputElement>(null);
  const targetSlot = useRef<LogoSlot | undefined>(undefined);
  const bp = useBreakpoint();
  const isDesktop = bp === "lg" || bp === "xl";

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

  /** 색 바꾸기 — `animate`면(견본·추천 배색처럼 한 번에 고를 때) 잉크로 번진다. 드래그·입력은 즉시. */
  const pick = (next: Record<string, string>, animate = false) => {
    setPicked(next);
    if (
      !animate ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    setInk((n) => n + 1);
  };
  const baseSvg = session?.preview_svg ?? null;
  const svg = baseSvg && recolorSvg(baseSvg, current, picked);
  // 배치형(panel)도 같은 슬롯 색을 쓴다 — 고른 색을 같이 입힌다.
  const panelSvg =
    session?.preview_panel_svg &&
    recolorSvg(session.preview_panel_svg, current, picked);

  const busy = uploading || ordering;
  const template = examplesQuery.data?.find(
    (t) => t.id === session?.example_id,
  );
  const logoSlots = template?.logo_slots ?? DEFAULT_LOGO_SLOTS;
  const placedAny = Object.values(logos).some((l) => l.status === "placed");

  const openPicker = (slot: LogoSlot | undefined) => {
    targetSlot.current = slot;
    fileRef.current?.click();
  };

  /** 올리면 바로 그 자리에 넣는다 — 같은 자리에 다시 올리면 덮어쓴다(서버도 슬롯 교체). */
  const addFile = async (slot: LogoSlot | undefined, file: File) => {
    if (!session) return;
    const key = slotKey(slot);
    const previous = logos[key];
    if (previous) URL.revokeObjectURL(previous.sourceUrl);
    const sourceUrl = URL.createObjectURL(file);
    const name = file.name.replace(/\.[^.]+$/, "") || "로고";
    const update = (patch: Partial<Logo>) =>
      setLogos((current) => {
        const logo = current[key];
        return logo?.sourceUrl === sourceUrl
          ? { ...current, [key]: { ...logo, ...patch } }
          : current;
      });
    setLogos((current) => ({
      ...current,
      [key]: { name, sourceUrl, status: "checking", error: null },
    }));
    setUploading(true);
    let checked = false;
    try {
      const isSvg =
        file.type === "image/svg+xml" ||
        file.name.toLocaleLowerCase().endsWith(".svg");
      const svg = isSvg
        ? await readDesignMotifSvg(file)
        : (await previewPhotoMotif({ uploadId: await uploadDesignPhoto(file) }))
            .svg;
      checked = true;
      update({ status: "placing" });
      await place.mutateAsync({ sessionId: session.id, slot, name, svg });
      update({ status: "placed" });
    } catch (cause) {
      update({
        status: "failed",
        error: checked
          ? designErrorMessage(cause, "디자인에 넣지 못했습니다.")
          : `미통과 · ${designErrorMessage(cause, "로고를 읽지 못했습니다.")}`,
      });
    } finally {
      setUploading(false);
    }
  };

  /** 지금 화면 디자인(고른 색 + 넣은 로고)을 PNG로 만들어 맞춤 주문 참고 이미지로 넘긴다. */
  const order = async () => {
    if (!svg || !placedAny || busy) return;
    setOrdering(true);
    try {
      const designFiles = await Promise.all([
        svgToPngFile(svg, "design.png"),
        ...(panelSvg ? [svgToPngFile(panelSvg, "design-panel.png")] : []),
      ]);
      navigate("/custom-order", { state: { designFiles } });
    } catch {
      snackbar("디자인을 준비하지 못했습니다.");
      setOrdering(false);
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
  const layout = sessionLayout(session, template);

  const choosePreset = (preset: Colorway) =>
    pick(
      Object.fromEntries(
        parts.flatMap((part) => {
          const hex = preset.mapping[part.slot];
          return hex ? [[part.slot, hex] as const] : [];
        }),
      ),
      true,
    );
  const swap = (render: (shot: TemplateShot) => ReactNode) => (
    <ShotSwap
      shot={shot}
      ink={ink}
      weave={baseSvg}
      waiting={uploading}
      render={render}
    />
  );
  const presetChips = presets.map((preset) => (
    <Chip
      key={preset.id}
      size="small"
      variant="outline"
      disabled={busy}
      selected={parts.every((part) =>
        sameHex(value(part.slot), preset.mapping[part.slot]),
      )}
      onClick={() => choosePreset(preset)}
      className="shrink-0"
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
              style={{ background: preset.mapping[part.slot] }}
            />
          ))}
        </HStack>
      }
    >
      {preset.name}
    </Chip>
  ));

  // PC 보기 전환 — 세 보기를 작은 그림으로 미리보기 왼쪽 칸에 세로로 둔다(모바일은 캔버스 스와이프).
  const viewThumbs = (
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
          {/* 선택은 흐림·글자색으로만 — 테두리 두께나 글자 크기를 바꾸면 칸이 흔들린다. */}
          <Box
            borderRadius="r2"
            overflow="hidden"
            bg="bg.layer-default"
            borderWidth={1}
            borderColor="stroke.neutral-weak"
            className="transition-opacity duration-200 ease-standard"
            style={{ opacity: view === value ? 1 : 0.5 }}
          >
            {/* TieCanvas 안쪽 여백(x6)은 고정 px라 작은 칸에선 넥타이가 작아진다 — 4배로 그려
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
            textStyle="labelSm"
            color={view === value ? "fg.neutral" : "fg.neutral-muted"}
            align="center"
          >
            {label}
          </Text>
        </VStack>
      ))}
    </VStack>
  );

  const orderButton = (
    <ActionButton
      variant="brandSolid"
      size="large"
      className="w-full"
      loading={ordering}
      disabled={!placedAny || busy}
      onClick={() => void order()}
    >
      바로 주문하기
    </ActionButton>
  );

  const logoStatus = (logo: Logo | undefined) =>
    logo?.error ? (
      <Text as="span" textStyle="caption" color="fg.critical">
        {logo.error}
      </Text>
    ) : logo?.status === "checking" ? (
      "1/2 · 배경을 확인하고 있어요 · 10초쯤 걸려요"
    ) : logo?.status === "placing" ? (
      "2/2 · 미리보기에 넣고 있어요"
    ) : logo?.status === "placed" ? (
      <Text as="span" textStyle="caption" color="fg.positive">
        통과 · 미리보기에 넣었어요
      </Text>
    ) : undefined;

  const fileInput = (
    <Box
      as="input"
      ref={fileRef}
      type="file"
      accept={`${DESIGN_PHOTO_ACCEPT},${DESIGN_SVG_ACCEPT}`}
      aria-label="로고 파일"
      hidden
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void addFile(targetSlot.current, file);
      }}
    />
  );

  // 자리마다 한 줄 — 누르면 파일을 고르고, 올린 로고는 바로 그 자리에 들어간다.
  const motifs = session.current_motifs ?? [];
  const logoRows = (
    <List aria-live="polite">
      {logoSlots.map(({ slot, label }, index) => {
        const logo = logos[slotKey(slot)];
        // 올리기 전에는 그 자리에 지금 들어 있는 템플릿 무늬를 보여준다.
        const placeholder =
          slot === "logo"
            ? template?.logo_preview_svg
            : motifs[(slot ?? (motifs.length >= 2 ? 2 : 1)) - 1]?.preview_svg;
        const title =
          label ?? (logoSlots.length > 1 ? `로고 ${index + 1}` : "로고");
        const working =
          logo?.status === "checking" || logo?.status === "placing";
        return (
          <ListItem
            key={slotKey(slot)}
            prefix={
              // 로고는 대개 배경이 없다 — 테두리 칸이 있어야 썸네일 왼쪽 끝이 줄마다 같아 보인다.
              <Box
                width={40}
                p="x1"
                borderRadius="r2"
                borderWidth={1}
                borderColor="stroke.neutral-weak"
                position="relative"
                overflow="hidden"
              >
                <ImageFrame
                  src={
                    logo?.sourceUrl ??
                    (placeholder ? svgToDataUri(placeholder) : undefined)
                  }
                  // 줄 제목이 이미 자리를 말한다 — 썸네일은 장식.
                  alt=""
                  ratio={1}
                  fit="contain"
                  borderRadius={0}
                />
                {working ? (
                  <Flex
                    position="absolute"
                    inset={0}
                    align="center"
                    justify="center"
                    bg="bg.image-scrim"
                  >
                    <ProgressCircle size={24} tone="contrast" />
                  </Flex>
                ) : null}
              </Box>
            }
            title={logo ? `${title} · ${logo.name}` : title}
            description={logoStatus(logo)}
            suffix={
              working ? undefined : (
                <Icon svg={<PencilSquareIcon />} size={20} />
              )
            }
            // 진행 중인 줄은 흐리지 않는다 — 어느 자리 차례인지 보여야 한다.
            disabled={busy && !working}
            onClick={working ? undefined : () => openPicker(slot)}
          />
        );
      })}
    </List>
  );

  if (!isDesktop) {
    return (
      <>
        <title>색·로고 | 영선산업</title>
        <meta name="robots" content="noindex, nofollow" />
        <MobileEditor
          canvas={
            <>
              {/* 보기 전환 — 캔버스를 옆으로 밀어 전체 → 대검 → 매듭(상품 사진 넘기기처럼 캔버스를 가리지 않는다).
                  넥타이는 칸에 맞춰 최대로 — 대검(4:5)·매듭(9:16)은 폭과 높이 중 좁은 쪽에 맞추고, 전체는
                  넥타이가 좁아 칸 높이에 맞춰 키운다(양옆 셔츠는 잘림). 전체·매듭은 깃이 캔버스 위에 붙는다. */}
              <Box position="absolute" inset={0}>
                <ScrollFog
                  ref={swipeRef}
                  size={0}
                  aria-label="미리보기 — 옆으로 밀어 전체·대검·매듭 보기"
                  className="snap-x snap-mandatory"
                  style={{ height: "100%" }}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    const i = Math.round(el.scrollLeft / el.clientWidth);
                    const next = MOBILE_VIEWS[i]?.[0];
                    if (next && next !== view) setView(next);
                  }}
                >
                  <HStack gap={0} height="full" alignItems="stretch">
                    {MOBILE_VIEWS.map(([v, label]) => (
                      <Box
                        key={v}
                        role="group"
                        aria-label={label}
                        position="relative"
                        flex="0 0 100%"
                        className="snap-center"
                      >
                        <Box
                          position="absolute"
                          inset={0}
                          overflow="hidden"
                          display="flex"
                          alignItems={v === "flat" ? "center" : "flex-start"}
                          justifyContent="center"
                          style={{ containerType: "size" }}
                        >
                          <Box
                            flex="none"
                            style={{
                              width:
                                v === "worn"
                                  ? "80cqh"
                                  : v === "knot"
                                    ? "min(100cqw, 56.25cqh)"
                                    : "min(100cqw, 80cqh)",
                            }}
                          >
                            {swap((s) =>
                              v === "flat" ? (
                                <TemplateTieShot shot={s} layout={layout} />
                              ) : v === "knot" ? (
                                <TemplateKnotTallShot
                                  shot={s}
                                  layout={layout}
                                />
                              ) : (
                                <TemplateWornShot shot={s} layout={layout} />
                              ),
                            )}
                          </Box>
                        </Box>
                      </Box>
                    ))}
                  </HStack>
                </ScrollFog>
              </Box>
              {/* 점 표시 + 지금 보기 이름 — 점을 눌러도 넘어간다. */}
              <HStack
                position="absolute"
                bottom={0}
                left="50%"
                gap="x2"
                px="x2_5"
                py="x1"
                mb="x3"
                borderRadius="full"
                bg="bg.image-scrim"
                style={{ transform: "translateX(-50%)" }}
              >
                {MOBILE_VIEWS.map(([v, label], i) => (
                  <Box
                    key={v}
                    as="button"
                    type="button"
                    aria-label={`${label} 보기`}
                    aria-pressed={view === v}
                    onClick={() => {
                      const el = swipeRef.current;
                      el?.scrollTo({
                        left: i * el.clientWidth,
                        behavior: "smooth",
                      });
                    }}
                    width={view === v ? 16 : 6}
                    height={6}
                    borderRadius="full"
                    bg="bg.layer-default"
                    className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
                    style={{ opacity: view === v ? 1 : 0.5 }}
                  />
                ))}
                <Text
                  as="span"
                  textStyle="captionSm"
                  color="fg.contrast"
                  aria-live="polite"
                >
                  {MOBILE_VIEWS.find(([v]) => v === view)?.[1]}
                </Text>
              </HStack>
              {parts.length > 0 ? (
                <Box position="absolute" bottom={0} right={0} p="x3">
                  {/* 지금 색을 칠한 동그라미 + 색 계열 링 — Canva의 색 타일·무지개 타일처럼 "색을 바꾸는 곳"으로 읽힌다. */}
                  <VStack
                    as="button"
                    type="button"
                    disabled={busy}
                    onClick={() => setSheetOpen(true)}
                    gap="x1"
                    className="cursor-pointer rounded-r2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring disabled:pointer-events-none disabled:opacity-50"
                  >
                    <Box
                      width={52}
                      height={52}
                      p="x1"
                      borderRadius="full"
                      boxShadow="s2"
                      style={{ background: FAMILY_RING }}
                    >
                      <Box
                        width="full"
                        height="full"
                        p="x0_5"
                        borderRadius="full"
                        bg="bg.layer-default"
                      >
                        <Box
                          width="full"
                          height="full"
                          borderRadius="full"
                          aria-hidden
                          style={{ background: value(parts[0]?.slot ?? "") }}
                        />
                      </Box>
                    </Box>
                    <Text as="span" textStyle="captionSm" color="fg.neutral">
                      색상 편집
                    </Text>
                  </VStack>
                </Box>
              ) : null}
            </>
          }
          panel={
            <VStack alignItems="stretch" gap="x3">
              {logoRows}
              {placedAny ? (
                orderButton
              ) : (
                <ActionButton
                  variant="brandSolid"
                  size="large"
                  className="w-full"
                  disabled={busy}
                  onClick={() => openPicker(logoSlots[0]?.slot)}
                >
                  로고 올리기
                </ActionButton>
              )}
            </VStack>
          }
        />
        <Modal
          open={sheetOpen}
          // 고른 색은 바로 적용된다 — 닫기·바깥 누르기는 시트만 닫는다.
          onOpenChange={setSheetOpen}
          title="색상 편집"
        >
          <ColorSheet
            presets={presetChips}
            parts={parts}
            slot={sheetSlot ?? parts[0]?.slot}
            onSlotChange={setSheetSlot}
            value={value}
            onChange={(slot, hex, animate) =>
              pick({ ...picked, [slot]: hex }, animate)
            }
            disabled={busy}
          />
        </Modal>
        {fileInput}
      </>
    );
  }

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
            {logoRows}
            {presets.length > 0 ? (
              <VStack alignItems="stretch" gap="x2">
                <Text as="span" textStyle="labelSm">
                  추천 배색
                </Text>
                <HStack gap="x2" flexWrap="wrap">
                  {presetChips}
                </HStack>
              </VStack>
            ) : null}
            <Accordion defaultValue={parts[0]?.slot}>
              {parts.map((part) => (
                <ColorPicker
                  key={part.slot}
                  part={part}
                  value={value(part.slot)}
                  onChange={(hex, animate) =>
                    pick({ ...picked, [part.slot]: hex }, animate)
                  }
                  disabled={busy}
                />
              ))}
            </Accordion>
          </VStack>
        }
        actionBar={orderButton}
      >
        <Grid templateColumns="72px minmax(0, 1fr)" gap="x3" alignItems="start">
          {viewThumbs}
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
                    swap((s) => <TemplateTieShot shot={s} layout={layout} />)
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
                    {swap((s) => (
                      <TemplateKnotShot shot={s} layout={layout} />
                    ))}
                  </Box>
                ) : null}
              </Box>
            ) : (
              swap((s) => <TemplateWornShot shot={s} layout={layout} />)
            )}
          </Box>
        </Grid>
      </ContentLayout>
      {fileInput}
    </>
  );
}

/**
 * 미리보기가 바뀌면 옛 것을 아래에 깔고 새 것을 드러낸다(index.css) — 색은 `ink`가 바뀔 때 가운데서
 * 번지고(`shot-ink`), 로고는 서버 디자인(`weave`)이 바뀔 때 위에서 짜여 내려온다(`shot-weave`).
 * 드래그·입력처럼 둘 다 그대로면 즉시 바꾼다. `waiting`이면 넥타이 안에 스캔 라인이 돈다.
 */
function ShotSwap({
  shot,
  ink,
  weave,
  waiting,
  render,
}: {
  shot: TemplateShot;
  ink: number;
  weave: string | null;
  waiting: boolean;
  render: (shot: TemplateShot) => ReactNode;
}) {
  const last = useRef(shot);
  const seen = useRef({ ink, weave });
  const [swap, setSwap] = useState<{
    n: number;
    prev: TemplateShot | null;
    effect: "shot-ink" | "shot-weave";
  }>({ n: 0, prev: null, effect: "shot-ink" });
  useLayoutEffect(() => {
    const inked = ink !== seen.current.ink;
    const woven = weave !== seen.current.weave;
    seen.current = { ink, weave };
    // 줄인 움직임이면 애니메이션이 없어 끝 이벤트도 없다 — 옛 미리보기를 깔지 않고 바로 바꾼다.
    if (
      (inked || woven) &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      const prev = last.current;
      setSwap((s) => ({
        n: s.n + 1,
        prev,
        effect: woven ? "shot-weave" : "shot-ink",
      }));
    }
    last.current = shot;
  });
  const { prev } = swap;
  return (
    <Box position="relative">
      {prev ? (
        <Box position="absolute" inset={0} aria-hidden>
          {render(prev)}
        </Box>
      ) : null}
      <Box
        key={swap.n}
        position="relative"
        className={prev ? swap.effect : undefined}
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget)
            setSwap((s) => ({ ...s, prev: null }));
        }}
      >
        {render(waiting ? { ...shot, scanning: true } : shot)}
      </Box>
    </Box>
  );
}

/** 모바일 캔버스 스와이프 순서 — 보기 값과 이름. */
const MOBILE_VIEWS = [
  ["worn", "전체"],
  ["flat", "대검"],
  ["knot", "매듭"],
] as const;

/**
 * 모바일 편집 화면 — 넥타이 캔버스가 남는 높이를 다 쓰고, 아래 패널(로고·CTA)이 제 높이만 차지한다.
 * 높이는 화면에서 헤더(모바일 56·태블릿 64 + 테두리 1)를 뺀 값.
 */
function MobileEditor({
  canvas,
  panel,
}: {
  canvas: ReactNode;
  panel: ReactNode;
}) {
  return (
    <VStack
      alignItems="stretch"
      gap={0}
      height={{ base: "calc(100dvh - 57px)", md: "calc(100dvh - 65px)" }}
    >
      <Text as="h1" textStyle="title1" className="sr-only">
        색·로고
      </Text>
      <Box position="relative" flex={1} minHeight={0} bg="bg.neutral-weak">
        {canvas}
      </Box>
      <Box
        flex="none"
        bg="bg.layer-default"
        px="x4"
        pt="x3"
        className="border-t border-stroke-neutral-weak"
        style={{
          paddingBottom:
            "calc(var(--spacing-x3) + env(safe-area-inset-bottom, 0px))",
        }}
      >
        {panel}
      </Box>
    </VStack>
  );
}

/** 모바일 색상 편집 시트 본문 — 추천 배색, 부위가 여럿이면 부위 칩, 그 부위의 계열·견본·색 코드. */
function ColorSheet({
  presets,
  parts,
  slot,
  onSlotChange,
  value,
  onChange,
  disabled,
}: {
  presets: ReactNode[];
  parts: Part[];
  slot: string | undefined;
  onSlotChange: (slot: string) => void;
  value: (slot: string) => string | undefined;
  onChange: (slot: string, hex: string, animate?: boolean) => void;
  disabled: boolean;
}) {
  const part = parts.find((item) => item.slot === slot) ?? parts[0];
  if (!part) return null;
  return (
    <VStack alignItems="stretch" gap="x5">
      {presets.length > 0 ? (
        <VStack alignItems="stretch" gap="x2">
          <Text as="span" textStyle="labelSm">
            추천 배색
          </Text>
          <ScrollFog>
            <HStack gap="x2">{presets}</HStack>
          </ScrollFog>
        </VStack>
      ) : null}
      <VStack alignItems="stretch" gap="x3">
        {parts.length > 1 ? (
          <ScrollFog>
            <HStack gap="x2">
              {parts.map((item) => (
                <Chip
                  key={item.slot}
                  size="small"
                  selected={item.slot === part.slot}
                  onClick={() => onSlotChange(item.slot)}
                  className="shrink-0"
                >
                  {item.name}
                </Chip>
              ))}
            </HStack>
          </ScrollFog>
        ) : (
          <Text as="span" textStyle="labelSm">
            {part.name}
          </Text>
        )}
        <ColorPickerBody
          key={part.slot}
          part={part}
          value={value(part.slot)}
          onChange={(hex, animate) => onChange(part.slot, hex, animate)}
          disabled={disabled}
          familyRow
        />
      </VStack>
    </VStack>
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
  onChange: (hex: string, animate?: boolean) => void;
  disabled: boolean;
}) {
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
        <ColorPickerBody
          part={part}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      </AccordionContent>
    </AccordionItem>
  );
}

/** 부위 하나의 고르기 본문 — 색 계열 칩, 계열 견본, 직접 고르기·색 코드 입력. 모바일 시트는 계열을 한 줄로. */
function ColorPickerBody({
  part,
  value,
  onChange,
  disabled,
  familyRow = false,
}: {
  part: Part;
  value: string | undefined;
  onChange: (hex: string, animate?: boolean) => void;
  disabled: boolean;
  familyRow?: boolean;
}) {
  const [family, setFamily] = useState(() => nearestFamily(value));
  const [draft, setDraft] = useState<string | null>(null);
  const display = value?.toUpperCase() ?? "";
  const familyChips = FAMILIES.map((item, index) => (
    <Chip
      key={item.name}
      size="small"
      selected={index === family}
      onClick={() => setFamily(index)}
      className={familyRow ? "shrink-0" : "justify-center"}
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
  ));

  return (
    <VStack alignItems="stretch" gap="x3">
      {familyRow ? (
        <ScrollFog>
          <HStack gap="x1_5">{familyChips}</HStack>
        </ScrollFog>
      ) : (
        <Grid columns={3} gap="x1_5">
          {familyChips}
        </Grid>
      )}
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
              onClick={() => onChange(hex, true)}
              width="full"
              borderRadius="r2"
              borderWidth={checked ? 2 : 1}
              borderColor={checked ? "stroke.neutral" : "stroke.neutral-weak"}
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
  );
}

import {
  ActionButton,
  Box,
  Divider,
  Flex,
  HStack,
  Icon,
  ImageFrame,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
  type MenuTriggerProps,
  ProgressCircle,
  Text,
  VStack,
} from "@essesion/shared";
import {
  ArrowUpTrayIcon,
  BookmarkIcon,
  CameraIcon,
  ChevronDownIcon,
  LanguageIcon,
  MagnifyingGlassIcon,
  PaintBrushIcon,
  PencilSquareIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { type ReactNode, useEffect, useRef, useState } from "react";

import {
  DESIGN_PHOTO_ACCEPT,
  DESIGN_SVG_ACCEPT,
  MAX_DESIGN_MOTIFS,
} from "@/features/design/api/attachments";
import { svgToDataUri } from "@/features/design/model/svg-preview";

export type MotifPanelSlot = {
  motifId: string;
  name: string | null;
  previewSvg: string;
};

/** 모달을 여는 소스 — SVG·사진은 파일 선택창이 먼저라 여기에 없다. */
export type MotifPanelSource = "search" | "library" | "generate" | "text";

export type MotifPanelProps = {
  /** 세션의 `current_motifs` — 레이어 순서, 최대 2 */
  motifs: readonly MotifPanelSlot[];
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** 소스를 고름 — 페이지가 슬롯을 열고 그 소스의 모달을 띄운다 */
  onPickSource: (slot: 1 | 2, source: MotifPanelSource) => void;
  /** SVG는 모달을 건너뛴다 — 파일 선택 즉시 저장·교체 */
  onAddSvg: (slot: 1 | 2, file: File) => void;
  /** 사진은 파일이 먼저, 확인 모달이 나중 */
  onAddPhoto: (slot: 1 | 2, file: File) => void;
  /** 남은 생성 횟수 — 유일한 유료 항목의 배지·잠금 */
  motifGenerationRemaining: number | null;
  /** SVG를 넣는 중인 슬롯 — 썸네일 자리에 진행 표시 */
  pendingSlot: 1 | 2 | null;
  /** 값이 증가할 때 피커 위치를 한 번 강조한다. */
  hintSignal?: number;
  /** 지금 피커가 열려 있는 슬롯 — 어느 칸을 채우는 중인지 테두리로 알린다. */
  activeSlot?: 1 | 2 | null;
  /** 아직 디자인이 없을 때 슬롯을 눌러도 메뉴 대신 시작 방법을 안내한다. */
  onStartRequired?: () => void;
  disabled?: boolean;
};

/**
 * 캔버스 좌측 모티프 카드. 슬롯 2개를 세로로 세워 "지금 무엇을 쓰는지"만 보여주고,
 * 슬롯을 누르면 소스 Menu가 열린다 — 무엇으로 넣을지 묻는 곳은 여기 하나다.
 */
export function MotifPanel({
  motifs,
  collapsed,
  onCollapsedChange,
  onPickSource,
  onAddSvg,
  onAddPhoto,
  motifGenerationRemaining,
  pendingSlot,
  hintSignal = 0,
  activeSlot = null,
  onStartRequired,
  disabled = false,
}: MotifPanelProps) {
  const slots = [1, 2] as const;
  const svgInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  // 파일 선택창은 슬롯을 모른다 — 어느 슬롯이 열었는지 여기에 적어 둔다.
  const fileSlot = useRef<1 | 2>(1);
  const [highlighted, setHighlighted] = useState(false);

  useEffect(() => {
    if (hintSignal === 0) return;
    setHighlighted(true);
    const timeout = window.setTimeout(() => setHighlighted(false), 1_600);
    return () => window.clearTimeout(timeout);
  }, [hintSignal]);

  const pickFile = (kind: "svg" | "photo", slot: 1 | 2) => {
    fileSlot.current = slot;
    (kind === "svg" ? svgInput : photoInput).current?.click();
  };

  return (
    <VStack
      role="region"
      aria-label="모티프 선택"
      position="relative"
      className="motif-panel-hint"
      data-highlighted={highlighted}
      alignItems="stretch"
      gap="x3"
      width={{ base: 60, md: 152 }}
      p={{ base: "x1_5", md: "x3" }}
      bg="bg.layer-floating"
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="r3"
      boxShadow="s1"
    >
      <HStack gap="x1_5" display={{ base: "none", md: "flex" }}>
        <Text as="h2" textStyle="labelSm">
          모티프
        </Text>
        <Text textStyle="captionSm" color="fg.neutral-subtle">
          {motifs.length}/{MAX_DESIGN_MOTIFS}
        </Text>
        <Box ml="auto">
          <ActionButton
            variant="ghost"
            size="xsmall"
            iconOnly
            aria-label={collapsed ? "모티프 카드 펼치기" : "모티프 카드 접기"}
            aria-expanded={!collapsed}
            onClick={() => onCollapsedChange(!collapsed)}
          >
            <Icon
              svg={<ChevronDownIcon />}
              size={16}
              className={`transition-transform duration-100 ease-standard ${collapsed ? "-rotate-90" : ""}`}
            />
          </ActionButton>
        </Box>
      </HStack>

      {collapsed ? (
        <HStack gap="x1" display={{ base: "none", md: "flex" }}>
          {slots.map((slot) => (
            <MiniChip key={slot} motif={motifs[slot - 1]} />
          ))}
        </HStack>
      ) : null}
      {/* base엔 제목 줄·미니 칩이 없으니 접힘 상태와 무관하게 슬롯을 보여준다. */}
      <VStack
        alignItems="stretch"
        gap="x3"
        display={{ base: "flex", md: collapsed ? "none" : "flex" }}
      >
        {slots.map((slot) => (
          <MotifSlotView
            key={slot}
            slot={slot}
            motif={motifs[slot - 1]}
            disabled={disabled}
            pending={pendingSlot === slot}
            active={activeSlot === slot}
            motifGenerationRemaining={motifGenerationRemaining}
            onPickSource={onPickSource}
            onPickFile={pickFile}
            onStartRequired={onStartRequired}
          />
        ))}
      </VStack>

      <input
        ref={svgInput}
        type="file"
        accept={DESIGN_SVG_ACCEPT}
        aria-label="SVG 모티프 파일 선택"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onAddSvg(fileSlot.current, file);
        }}
      />
      <input
        ref={photoInput}
        type="file"
        accept={DESIGN_PHOTO_ACCEPT}
        aria-label="모티프로 따올 사진 선택"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onAddPhoto(fileSlot.current, file);
        }}
      />
    </VStack>
  );
}

function MiniChip({ motif }: { motif: MotifPanelSlot | undefined }) {
  return (
    <Box width={24} height={24}>
      <ImageFrame
        ratio={1}
        borderRadius="r2"
        stroke
        fit="contain"
        src={motif ? svgToDataUri(motif.previewSvg) : undefined}
        alt={motif ? (motif.name ?? "모티프") : "빈 슬롯"}
      />
    </Box>
  );
}

type SlotMenuProps = {
  slot: 1 | 2;
  motifGenerationRemaining: number | null;
  onPickSource: (slot: 1 | 2, source: MotifPanelSource) => void;
  onPickFile: (kind: "svg" | "photo", slot: 1 | 2) => void;
  onStartRequired?: () => void;
  disabled: boolean;
  children: MenuTriggerProps["children"];
};

/** 메뉴 구획 — 보이는 제목은 group 라벨이 대신 읽으므로 스크린리더에서 숨긴다. */
function MenuGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <VStack role="group" aria-label={label} gap="x0_5" alignItems="stretch">
      <Text
        aria-hidden
        textStyle="captionSm"
        color="fg.neutral-subtle"
        px="x2"
        py="x1"
      >
        {label}
      </Text>
      {children}
    </VStack>
  );
}

/** 슬롯 하나의 소스 목록. 빈 슬롯·미리보기·편집 버튼이 모두 이 메뉴를 연다. */
function SlotMenu({
  slot,
  motifGenerationRemaining,
  onPickSource,
  onPickFile,
  onStartRequired,
  disabled,
  children,
}: SlotMenuProps) {
  if (onStartRequired) {
    // 슬롯 버튼은 disabled에서 pointer-events가 죽어 클릭이 래퍼로 올라온다 — 안내도 같이 막는다.
    return (
      <Box onClick={disabled ? undefined : onStartRequired}>{children}</Box>
    );
  }
  const exhausted =
    motifGenerationRemaining !== null && motifGenerationRemaining <= 0;
  return (
    <MenuRoot>
      <MenuTrigger>{children}</MenuTrigger>
      <MenuContent aria-label={`슬롯 ${slot}에 그림 넣는 방법`}>
        <MenuGroup label="고르기">
          <MenuItem
            prefixIcon={<Icon svg={<MagnifyingGlassIcon />} size={20} />}
            label="탐색"
            description="문장으로 카탈로그에서 찾아요"
            onClick={() => onPickSource(slot, "search")}
          />
          <MenuItem
            prefixIcon={<Icon svg={<BookmarkIcon />} size={20} />}
            label="내 모티프"
            description="저장해 둔 그림에서 골라요"
            onClick={() => onPickSource(slot, "library")}
          />
        </MenuGroup>
        <Box py="x1">
          <Divider />
        </Box>
        <MenuGroup label="만들기">
          <MenuItem
            prefixIcon={<Icon svg={<PaintBrushIcon />} size={20} />}
            label="AI 생성"
            description={
              exhausted
                ? "이번 디자인에서 더 만들 수 없어요"
                : motifGenerationRemaining === null
                  ? "문장 그대로 새로 만들어요"
                  : `문장 그대로 새로 만들어요 · ${motifGenerationRemaining}번 남음`
            }
            disabled={exhausted}
            onClick={() => onPickSource(slot, "generate")}
          />
          <MenuItem
            prefixIcon={<Icon svg={<LanguageIcon />} size={20} />}
            label="글자 넣기"
            description="짧은 글자를 그림으로 만들어요"
            onClick={() => onPickSource(slot, "text")}
          />
          <MenuItem
            prefixIcon={<Icon svg={<CameraIcon />} size={20} />}
            label="사진에서 따오기"
            description="사진에서 배경을 지우고 색면을 정리해요"
            onClick={() => onPickFile("photo", slot)}
          />
          <MenuItem
            prefixIcon={<Icon svg={<ArrowUpTrayIcon />} size={20} />}
            label="SVG 올리기"
            description="가지고 있는 SVG 파일을 넣어요"
            onClick={() => onPickFile("svg", slot)}
          />
        </MenuGroup>
      </MenuContent>
    </MenuRoot>
  );
}

function MotifSlotView({
  slot,
  motif,
  disabled,
  pending,
  active,
  motifGenerationRemaining,
  onPickSource,
  onPickFile,
  onStartRequired,
}: {
  slot: 1 | 2;
  motif: MotifPanelSlot | undefined;
  disabled: boolean;
  pending: boolean;
  active: boolean;
  motifGenerationRemaining: number | null;
  onPickSource: (slot: 1 | 2, source: MotifPanelSource) => void;
  onPickFile: (kind: "svg" | "photo", slot: 1 | 2) => void;
  onStartRequired?: () => void;
}) {
  // 피커가 열려 있는 동안 어느 슬롯을 채우는 중인지 테두리로 남긴다.
  const ring = active ? " outline-2 outline-offset-2 outline-stroke-brand" : "";
  const menu = {
    slot,
    motifGenerationRemaining,
    onPickSource,
    onPickFile,
    onStartRequired,
    disabled,
  };

  if (pending) {
    return (
      <VStack
        align="center"
        justify="center"
        gap="x1_5"
        width="full"
        borderWidth={1}
        borderColor="stroke.neutral-weak"
        borderRadius="r2"
        style={{ aspectRatio: 1 }}
        aria-busy="true"
        aria-label={`모티프 슬롯 ${slot} 올리는 중`}
      >
        <ProgressCircle size={24} />
        <Text
          textStyle="captionSm"
          color="fg.neutral-subtle"
          display={{ base: "none", md: "block" }}
        >
          올리는 중…
        </Text>
      </VStack>
    );
  }

  if (!motif) {
    return (
      <SlotMenu {...menu}>
        <Flex
          as="button"
          type="button"
          direction="column"
          align="center"
          justify="center"
          gap="x1_5"
          width="full"
          borderRadius="r2"
          disabled={disabled}
          aria-label={`모티프 슬롯 ${slot}에 그림 추가`}
          aria-current={active ? "true" : undefined}
          className={`border border-dashed border-stroke-neutral bg-bg-layer-default text-fg-neutral-subtle transition-colors duration-100 ease-standard hover:bg-bg-neutral-weak focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring disabled:pointer-events-none disabled:opacity-50${ring}`}
          style={{ aspectRatio: 1 }}
        >
          <Icon svg={<PlusIcon />} size={22} />
          <Text
            textStyle="captionSm"
            color="fg.neutral-subtle"
            display={{ base: "none", md: "block" }}
          >
            그림 추가
          </Text>
        </Flex>
      </SlotMenu>
    );
  }

  const name = motif.name ?? "모티프";
  return (
    <VStack alignItems="stretch" gap="x2">
      {/* base엔 편집 버튼 줄이 없다 — 미리보기 자체가 메뉴 진입점을 겸한다. */}
      <SlotMenu {...menu}>
        <Box
          as="button"
          type="button"
          width="full"
          borderRadius="r2"
          disabled={disabled}
          aria-label={`${name} 바꾸기`}
          aria-current={active ? "true" : undefined}
          className={`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring disabled:pointer-events-none${ring}`}
        >
          <ImageFrame
            ratio={1}
            borderRadius="r2"
            stroke
            fit="contain"
            src={svgToDataUri(motif.previewSvg)}
            alt={name}
          />
        </Box>
      </SlotMenu>
      <HStack gap="x1_5" display={{ base: "none", md: "flex" }}>
        <Text textStyle="captionSm" maxLines={1} minWidth={0}>
          {name}
        </Text>
        <Box ml="auto">
          <SlotMenu {...menu}>
            <ActionButton
              variant="neutralOutline"
              size="xsmall"
              disabled={disabled}
              aria-label={`${name} 편집 메뉴`}
            >
              <Icon svg={<PencilSquareIcon />} size={14} />
              편집
            </ActionButton>
          </SlotMenu>
        </Box>
      </HStack>
    </VStack>
  );
}

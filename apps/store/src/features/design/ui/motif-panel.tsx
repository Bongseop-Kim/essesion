import {
  ActionButton,
  Box,
  Flex,
  HStack,
  Icon,
  ImageFrame,
  Text,
  VStack,
} from "@essesion/shared";
import {
  ChevronDownIcon,
  PencilSquareIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";

import { MAX_DESIGN_MOTIFS } from "@/features/design/api/attachments";
import { svgToDataUri } from "@/features/design/model/svg-preview";

export type MotifPanelSlot = {
  motifId: string;
  name: string | null;
  previewSvg: string;
};

export type MotifPanelProps = {
  /** 세션의 `current_motifs` — 레이어 순서, 최대 2 */
  motifs: readonly MotifPanelSlot[];
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** 슬롯 편집·추가 — 슬롯 번호(1·2)로 모티프 모달을 연다 */
  onEditSlot: (slot: 1 | 2) => void;
  disabled?: boolean;
};

/**
 * 캔버스 좌측 모티프 카드. 슬롯 2개를 세로로 세워 "지금 무엇을 쓰는지"만 보여주고,
 * 교체·추가는 모티프 모달로 넘긴다. 접으면 제목 줄과 24px 미니 칩만 남는다.
 */
export function MotifPanel({
  motifs,
  collapsed,
  onCollapsedChange,
  onEditSlot,
  disabled = false,
}: MotifPanelProps) {
  const slots = [1, 2] as const;
  return (
    <VStack
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
            onEdit={onEditSlot}
          />
        ))}
      </VStack>
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

function MotifSlotView({
  slot,
  motif,
  disabled,
  onEdit,
}: {
  slot: 1 | 2;
  motif: MotifPanelSlot | undefined;
  disabled: boolean;
  onEdit: (slot: 1 | 2) => void;
}) {
  if (!motif) {
    return (
      <Flex
        as="button"
        type="button"
        direction="column"
        alignItems="center"
        justifyContent="center"
        gap="x1_5"
        width="full"
        borderRadius="r2"
        style={{ aspectRatio: 1 }}
        onClick={() => onEdit(slot)}
        disabled={disabled}
        aria-label={`모티프 슬롯 ${slot}에 그림 추가`}
        className="border border-dashed border-stroke-neutral bg-bg-layer-default text-fg-neutral-subtle transition-colors duration-100 ease-standard hover:bg-bg-neutral-weak focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring disabled:pointer-events-none disabled:opacity-50"
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
    );
  }

  const name = motif.name ?? "모티프";
  return (
    <VStack alignItems="stretch" gap="x2">
      {/* base엔 편집 버튼 줄이 없다 — 미리보기 자체가 편집 진입점을 겸한다. */}
      <Box
        as="button"
        type="button"
        width="full"
        borderRadius="r2"
        onClick={() => onEdit(slot)}
        disabled={disabled}
        aria-label={`${name} 바꾸기`}
        className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring disabled:pointer-events-none"
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
      <HStack gap="x1_5" display={{ base: "none", md: "flex" }}>
        <Text textStyle="captionSm" maxLines={1} minWidth={0}>
          {name}
        </Text>
        <Box ml="auto">
          <ActionButton
            variant="neutralOutline"
            size="xsmall"
            onClick={() => onEdit(slot)}
            disabled={disabled}
            aria-label={`${name} 바꾸기`}
          >
            <Icon svg={<PencilSquareIcon />} size={14} />
            편집
          </ActionButton>
        </Box>
      </HStack>
    </VStack>
  );
}

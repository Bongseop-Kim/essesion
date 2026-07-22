import {
  ActionButton,
  Box,
  Chip,
  Flex,
  Grid,
  HStack,
  Icon,
  ImageFrame,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
  ScrollFog,
  Text,
  VStack,
} from "@essesion/shared";
import {
  AdjustmentsHorizontalIcon,
  BookmarkSquareIcon,
  CameraIcon,
  ChevronDownIcon,
  CreditCardIcon,
  LanguageIcon,
  PaintBrushIcon,
  PaperAirplaneIcon,
  PhotoIcon,
  PlusIcon,
  PuzzlePieceIcon,
  SparklesIcon,
  SquaresPlusIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  type ChangeEvent,
  type ComponentPropsWithRef,
  type FormEvent,
  type ReactNode,
  useRef,
  useState,
} from "react";

import {
  DESIGN_PHOTO_ACCEPT,
  MAX_DESIGN_MOTIFS,
} from "@/features/design/api/attachments";
import {
  REFERENCE_IMAGE_PURPOSES,
  type ReferenceImagePurpose,
  referenceImagePurposeLabel,
} from "@/features/design/model/draft";
import { krw } from "@/shared/lib/format";

type ChatInputProps = Omit<
  ComponentPropsWithRef<"input">,
  "prefix" | "size"
> & {
  leading?: ReactNode;
  trailing?: ReactNode;
};

function ChatInput({ leading, trailing, ...inputProps }: ChatInputProps) {
  return (
    <Flex
      gap="x1"
      align="center"
      width="full"
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="full"
      bg="bg.layer-default"
      px="x1_5"
      className="h-12 transition-colors duration-100 ease-standard focus-within:outline focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-stroke-brand"
    >
      {leading}
      <input
        {...inputProps}
        className="w-full min-w-0 flex-1 bg-transparent px-x1 text-t4 text-fg-neutral outline-none placeholder:text-fg-placeholder disabled:text-fg-disabled"
      />
      {trailing}
    </Flex>
  );
}

const CANDIDATE_COUNTS = [1, 2, 3, 4] as const;

export type MotifAddKind = "svg" | "text" | "photo";

export type ComposerAttachment = {
  id: string;
  kind: "photo" | "motif";
  name: string;
  previewSrc: string;
  purpose?: ReferenceImagePurpose;
};

export type ComposerPanelItemProps = Omit<
  ComponentPropsWithRef<"button">,
  "children"
> & {
  icon: ReactNode;
  label: string;
};

/** ＋ 패널의 원형 아이콘 + 아래 라벨 항목 (카카오톡 첨부 패널 스타일). */
export function ComposerPanelItem({
  icon,
  label,
  className,
  type = "button",
  ...buttonProps
}: ComposerPanelItemProps) {
  return (
    <Flex
      as="button"
      type={type}
      direction="column"
      align="center"
      gap="x1_5"
      className={`group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring disabled:pointer-events-none disabled:opacity-50 ${className ?? ""}`}
      {...buttonProps}
    >
      <Flex
        align="center"
        justify="center"
        width={52}
        height={52}
        borderRadius="full"
        bg="bg.neutral-weak"
        className="transition-colors duration-100 ease-standard group-hover:bg-bg-neutral-weak-hover group-active:bg-bg-neutral-weak-pressed"
      >
        {icon}
      </Flex>
      <Text textStyle="captionSm" color="fg.neutral" align="center">
        {label}
      </Text>
    </Flex>
  );
}

export type DesignComposerProps = {
  prompt: string;
  candidateCount: number;
  onPromptChange: (prompt: string) => void;
  onCandidateCountChange: (count: number) => void;
  onSubmit: () => void;
  balance?: number | null;
  generateCost?: number | null;
  onPurchaseTokens?: () => void;
  onPhotoFilesSelect: (files: File[]) => void;
  onAddMotif: (kind: MotifAddKind) => void;
  onOpenMotifLibrary: () => void;
  onOpenColors: () => void;
  onOpenPatternSettings: () => void;
  onOpenIdeas: () => void;
  attachments?: readonly ComposerAttachment[];
  onRemoveAttachment?: (id: string) => void;
  onPhotoPurposeChange?: (id: string, purpose: ReferenceImagePurpose) => void;
  paletteColors?: readonly string[];
  patternSummary?: readonly string[];
  motifSlotCount?: number;
  onResetPalette?: () => void;
  onResetPattern?: () => void;
  canSubmitWithoutPrompt?: boolean;
  loading?: boolean;
  disabled?: boolean;
  submitLabel?: string;
  sessionActions?: ReactNode;
};

export function DesignComposer({
  prompt,
  candidateCount,
  onPromptChange,
  onCandidateCountChange,
  onSubmit,
  balance,
  generateCost,
  onPurchaseTokens,
  onPhotoFilesSelect,
  onAddMotif,
  onOpenMotifLibrary,
  onOpenColors,
  onOpenPatternSettings,
  onOpenIdeas,
  attachments = [],
  onRemoveAttachment,
  onPhotoPurposeChange,
  paletteColors = [],
  patternSummary = [],
  motifSlotCount = 0,
  onResetPalette,
  onResetPattern,
  canSubmitWithoutPrompt = false,
  loading = false,
  disabled = false,
  submitLabel = "디자인 생성",
  sessionActions,
}: DesignComposerProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const controlsDisabled = disabled || loading;
  const submitDisabled =
    disabled || (prompt.trim().length === 0 && !canSubmitWithoutPrompt);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!submitDisabled && !loading) onSubmit();
  };
  const handleFiles = (
    event: ChangeEvent<HTMLInputElement>,
    onSelect: (files: File[]) => void,
  ) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length > 0) onSelect(files);
  };

  return (
    <Box as="form" onSubmit={handleSubmit} width="full">
      <VStack gap="x3" alignItems="stretch">
        {attachments.length > 0 ? (
          <ScrollFog direction="horizontal" aria-label="현재 첨부">
            <HStack gap="x2" className="min-w-max px-x1 py-x1">
              {attachments.map((attachment) => (
                <HStack
                  key={attachment.id}
                  gap="x2"
                  borderWidth={1}
                  borderColor="stroke.neutral-weak"
                  borderRadius="r3"
                  bg="bg.neutral-weak"
                  p="x1"
                  pr="x1_5"
                  className="max-w-48"
                >
                  <Box width={36} height={36} className="shrink-0">
                    <ImageFrame
                      ratio={1}
                      src={attachment.previewSrc}
                      alt=""
                      fit="contain"
                      borderRadius="r2"
                    />
                  </Box>
                  <VStack gap="x0_5" alignItems="stretch" minWidth={0}>
                    <Text textStyle="captionSm" className="truncate">
                      {attachment.name}
                    </Text>
                    {attachment.kind === "photo" && onPhotoPurposeChange ? (
                      <MenuRoot placement="top">
                        <MenuTrigger>
                          <ActionButton
                            type="button"
                            size="xsmall"
                            variant="ghost"
                            className="h-auto min-w-0 justify-start px-0 py-0 font-normal"
                            aria-label={`${attachment.name} 참고 방식: ${referenceImagePurposeLabel(attachment.purpose ?? "auto")}`}
                            disabled={loading}
                          >
                            <Text
                              as="span"
                              textStyle="captionSm"
                              color="fg.neutral-subtle"
                              className="truncate"
                            >
                              {referenceImagePurposeLabel(
                                attachment.purpose ?? "auto",
                              )}
                            </Text>
                            <Icon svg={<ChevronDownIcon />} size={12} />
                          </ActionButton>
                        </MenuTrigger>
                        <MenuContent
                          aria-label={`${attachment.name} 참고 방식`}
                        >
                          {REFERENCE_IMAGE_PURPOSES.map((option) => (
                            <MenuItem
                              key={option.value}
                              label={
                                option.value === "motif" &&
                                (attachment.purpose ?? "auto") !== "motif" &&
                                motifSlotCount >= MAX_DESIGN_MOTIFS
                                  ? "모티프 형태 참고 (모티프 슬롯이 가득 참)"
                                  : option.label
                              }
                              disabled={
                                option.value === "motif" &&
                                (attachment.purpose ?? "auto") !== "motif" &&
                                motifSlotCount >= MAX_DESIGN_MOTIFS
                              }
                              checked={
                                (attachment.purpose ?? "auto") === option.value
                              }
                              onClick={() =>
                                onPhotoPurposeChange(
                                  attachment.id,
                                  option.value,
                                )
                              }
                            />
                          ))}
                        </MenuContent>
                      </MenuRoot>
                    ) : (
                      <Text textStyle="captionSm" color="fg.neutral-subtle">
                        모티프
                      </Text>
                    )}
                  </VStack>
                  {onRemoveAttachment ? (
                    <ActionButton
                      type="button"
                      size="xsmall"
                      variant="neutralWeak"
                      iconOnly
                      aria-label={`${attachment.name} 첨부 삭제`}
                      onClick={() => onRemoveAttachment(attachment.id)}
                      disabled={loading}
                    >
                      <Icon svg={<XMarkIcon />} size={14} />
                    </ActionButton>
                  ) : null}
                </HStack>
              ))}
            </HStack>
          </ScrollFog>
        ) : null}

        {paletteColors.length > 0 || patternSummary.length > 0 ? (
          <ScrollFog direction="horizontal" aria-label="현재 생성 설정">
            <HStack gap="x2" className="min-w-max px-x1 py-x1">
              {paletteColors.length > 0 ? (
                <Chip
                  size="small"
                  variant="outline"
                  selected
                  aria-label="적용 색상 전체 초기화"
                  onClick={onResetPalette}
                  prefix={
                    <HStack gap="x0_5" aria-hidden>
                      {paletteColors.slice(0, 5).map((color) => (
                        <Box
                          as="span"
                          key={color}
                          width={10}
                          height={10}
                          borderRadius="full"
                          borderWidth={1}
                          borderColor="stroke.neutral-weak"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </HStack>
                  }
                >
                  색상 {paletteColors.length}개 · 초기화
                </Chip>
              ) : null}
              {patternSummary.length > 0 ? (
                <Chip
                  size="small"
                  variant="outline"
                  selected
                  aria-label="패턴 설정 전체 초기화"
                  onClick={onResetPattern}
                >
                  {patternSummary.join(" · ")} · 초기화
                </Chip>
              ) : null}
            </HStack>
          </ScrollFog>
        ) : null}

        <ChatInput
          aria-label="어떤 디자인을 만들까요?"
          placeholder="원하는 색상, 무늬, 분위기를 입력하세요"
          value={prompt}
          onChange={(event) => onPromptChange(event.currentTarget.value)}
          disabled={controlsDisabled}
          leading={
            <ActionButton
              type="button"
              variant="neutralWeak"
              size="small"
              iconOnly
              aria-label="옵션 더보기"
              aria-expanded={optionsOpen}
              className={`rounded-full transition-transform duration-100 ease-standard ${optionsOpen ? "rotate-45" : ""}`}
              onClick={() => setOptionsOpen((open) => !open)}
            >
              <Icon svg={<PlusIcon />} size={20} />
            </ActionButton>
          }
          trailing={
            <HStack gap="x1">
              <ActionButton
                type="button"
                variant="ghost"
                size="small"
                iconOnly
                aria-label="문맥 기반 아이디어"
                onClick={onOpenIdeas}
                disabled={controlsDisabled}
                className="rounded-full"
              >
                <Icon svg={<SparklesIcon />} size={18} />
              </ActionButton>
              <ActionButton
                type="submit"
                size="small"
                iconOnly
                aria-label={submitLabel}
                loading={loading}
                disabled={submitDisabled}
                className="rounded-full"
              >
                <Icon svg={<PaperAirplaneIcon />} size={18} />
              </ActionButton>
            </HStack>
          }
        />

        {optionsOpen ? (
          <VStack gap="x3" alignItems="stretch" pt="x1">
            <Grid columns={{ base: 4, md: 5 }} gap="x3" alignItems="start">
              <ComposerPanelItem
                icon={<Icon svg={<PhotoIcon />} size={24} />}
                label="사진 첨부"
                onClick={() => photoInputRef.current?.click()}
                disabled={controlsDisabled}
              />
              <ComposerPanelItem
                icon={<Icon svg={<PuzzlePieceIcon />} size={24} />}
                label="SVG 모티프"
                onClick={() => onAddMotif("svg")}
                disabled={controlsDisabled}
              />
              <ComposerPanelItem
                icon={<Icon svg={<LanguageIcon />} size={24} />}
                label="텍스트 모티프"
                onClick={() => onAddMotif("text")}
                disabled={controlsDisabled}
              />
              <ComposerPanelItem
                icon={<Icon svg={<CameraIcon />} size={24} />}
                label="사진 모티프"
                onClick={() => onAddMotif("photo")}
                disabled={controlsDisabled}
              />
              <ComposerPanelItem
                icon={<Icon svg={<BookmarkSquareIcon />} size={24} />}
                label="내 모티프"
                onClick={onOpenMotifLibrary}
                disabled={controlsDisabled}
              />
              <ComposerPanelItem
                icon={<Icon svg={<PaintBrushIcon />} size={24} />}
                label="색상"
                onClick={onOpenColors}
                disabled={controlsDisabled}
              />
              <ComposerPanelItem
                icon={<Icon svg={<AdjustmentsHorizontalIcon />} size={24} />}
                label="패턴 설정"
                onClick={onOpenPatternSettings}
                disabled={controlsDisabled}
              />
              <MenuRoot placement="top">
                <MenuTrigger>
                  <ComposerPanelItem
                    icon={<Icon svg={<SquaresPlusIcon />} size={24} />}
                    label={`후보 ${candidateCount}개`}
                    disabled={controlsDisabled}
                  />
                </MenuTrigger>
                <MenuContent aria-label="한 번에 만들 후보 수">
                  {CANDIDATE_COUNTS.map((count) => (
                    <MenuItem
                      key={count}
                      label={`${count}개`}
                      checked={candidateCount === count}
                      onClick={() => onCandidateCountChange(count)}
                    />
                  ))}
                </MenuContent>
              </MenuRoot>
              {sessionActions}
              {onPurchaseTokens ? (
                <ComposerPanelItem
                  icon={<Icon svg={<CreditCardIcon />} size={24} />}
                  label="충전"
                  onClick={onPurchaseTokens}
                  disabled={controlsDisabled}
                />
              ) : null}
            </Grid>

            <Flex justify="flex-end">
              <Text textStyle="captionSm" color="fg.neutral-subtle">
                잔액 {formatTokens(balance)}토큰 · 생성 1회{" "}
                {formatTokens(generateCost)}토큰
              </Text>
            </Flex>
          </VStack>
        ) : null}
      </VStack>
      <input
        ref={photoInputRef}
        type="file"
        accept={DESIGN_PHOTO_ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => handleFiles(event, onPhotoFilesSelect)}
      />
    </Box>
  );
}

function formatTokens(value: number | null | undefined) {
  return value == null ? "—" : krw.format(value);
}

import {
  ActionButton,
  Box,
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
  BookmarkSquareIcon,
  CreditCardIcon,
  DocumentArrowUpIcon,
  PaperAirplaneIcon,
  PhotoIcon,
  PlusIcon,
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
  DESIGN_SVG_ACCEPT,
} from "@/features/design/api/attachments";
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

export type ComposerAttachment = {
  id: string;
  kind: "photo" | "svg";
  name: string;
  previewSrc: string;
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
  onSvgFilesSelect: (files: File[]) => void;
  onOpenMotifLibrary: () => void;
  attachments?: readonly ComposerAttachment[];
  onRemoveAttachment?: (id: string) => void;
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
  onSvgFilesSelect,
  onOpenMotifLibrary,
  attachments = [],
  onRemoveAttachment,
  canSubmitWithoutPrompt = false,
  loading = false,
  disabled = false,
  submitLabel = "디자인 생성",
  sessionActions,
}: DesignComposerProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const svgInputRef = useRef<HTMLInputElement>(null);
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
                    <Text textStyle="captionSm" color="fg.neutral-subtle">
                      {attachment.kind === "photo" ? "참고 사진" : "모티프"}
                    </Text>
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
          }
        />

        {optionsOpen ? (
          <VStack gap="x3" alignItems="stretch" pt="x1">
            <Grid columns={{ base: 4, md: 8 }} gap="x3" alignItems="start">
              <ComposerPanelItem
                icon={<Icon svg={<PhotoIcon />} size={24} />}
                label="사진 첨부"
                onClick={() => photoInputRef.current?.click()}
                disabled={controlsDisabled}
              />
              <ComposerPanelItem
                icon={<Icon svg={<DocumentArrowUpIcon />} size={24} />}
                label="SVG 첨부"
                onClick={() => svgInputRef.current?.click()}
                disabled={controlsDisabled}
              />
              <ComposerPanelItem
                icon={<Icon svg={<BookmarkSquareIcon />} size={24} />}
                label="내 모티프"
                onClick={onOpenMotifLibrary}
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
      <input
        ref={svgInputRef}
        type="file"
        accept={DESIGN_SVG_ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => handleFiles(event, onSvgFilesSelect)}
      />
    </Box>
  );
}

function formatTokens(value: number | null | undefined) {
  return value == null ? "—" : krw.format(value);
}

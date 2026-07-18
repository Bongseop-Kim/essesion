import {
  ActionButton,
  Box,
  Chip,
  Flex,
  HStack,
  Icon,
  Text,
  VStack,
} from "@essesion/shared";
import {
  CreditCardIcon,
  PaperAirplaneIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import {
  type ComponentPropsWithRef,
  type FormEvent,
  type ReactNode,
  useState,
} from "react";

import { krw } from "@/shared/lib/format";

type ChatInputProps = Omit<
  ComponentPropsWithRef<"input">,
  "prefix" | "size"
> & {
  /** 필 안 왼쪽에 놓이는 버튼 (예: 옵션 더보기). */
  leading?: ReactNode;
  /** 필 안 오른쪽에 놓이는 버튼 (예: 전송). */
  trailing?: ReactNode;
};

/** 채팅창용 한 줄 입력 필. 양옆 버튼이 입력창 내부에 있는 것처럼 보이는
 *  메신저 스타일 — 높이 고정(리사이즈 없음), Enter로 폼 제출. */
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

const DEFAULT_HINTS: readonly ComposerHint[] = [
  { id: "navy", label: "네이비", prompt: "네이비 색상을 중심으로" },
  { id: "geometric", label: "기하학", prompt: "기하학 패턴으로" },
  { id: "silk", label: "실크", prompt: "실크 원단에 어울리게" },
];

export type ComposerHint = {
  id: string;
  label: string;
  prompt: string;
};

export type ComposerPanelItemProps = {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

/** ＋ 패널의 원형 아이콘 + 아래 라벨 항목 (카카오톡 첨부 패널 스타일). */
export function ComposerPanelItem({
  icon,
  label,
  onClick,
  disabled = false,
}: ComposerPanelItemProps) {
  return (
    <Flex
      as="button"
      type="button"
      direction="column"
      align="center"
      gap="x1_5"
      onClick={onClick}
      disabled={disabled}
      className="group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring disabled:pointer-events-none disabled:opacity-50"
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
      <Text textStyle="captionSm" color="fg.neutral">
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
  hints?: readonly ComposerHint[];
  onHintSelect?: (hint: ComposerHint, selected: boolean) => void;
  balance?: number | null;
  generateCost?: number | null;
  onPurchaseTokens?: () => void;
  loading?: boolean;
  disabled?: boolean;
  submitLabel?: string;
  /** ＋ 패널 그리드에 붙는 슬롯 — ComposerPanelItem들을 넘긴다 (예: 내 세션·새로 만들기). */
  sessionActions?: ReactNode;
};

export function DesignComposer({
  prompt,
  candidateCount,
  onPromptChange,
  onCandidateCountChange,
  onSubmit,
  hints = DEFAULT_HINTS,
  onHintSelect,
  balance,
  generateCost,
  onPurchaseTokens,
  loading = false,
  disabled = false,
  submitLabel = "디자인 생성",
  sessionActions,
}: DesignComposerProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const submitDisabled = disabled || prompt.trim().length === 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!submitDisabled && !loading) onSubmit();
  };

  const handleHintSelect = (hint: ComposerHint, selected: boolean) => {
    if (onHintSelect) {
      onHintSelect(hint, !selected);
      return;
    }
    if (selected) {
      onPromptChange(
        prompt
          .replace(hint.prompt, "")
          .replace(/\s{2,}/g, " ")
          .trim(),
      );
      return;
    }
    const current = prompt.trim();
    onPromptChange(current ? `${hint.prompt} ${current}` : hint.prompt);
  };

  return (
    <Box as="form" onSubmit={handleSubmit} width="full">
      <VStack gap="x3" alignItems="stretch">
        <ChatInput
          aria-label="어떤 디자인을 만들까요?"
          placeholder="원하는 색상, 무늬, 분위기를 입력하세요"
          value={prompt}
          onChange={(event) => onPromptChange(event.currentTarget.value)}
          disabled={disabled || loading}
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
          <VStack gap="x4" alignItems="stretch" pt="x1">
            <HStack gap="x5" align="flex-start">
              {sessionActions}
              {onPurchaseTokens ? (
                <ComposerPanelItem
                  icon={<Icon svg={<CreditCardIcon />} size={24} />}
                  label="충전"
                  onClick={onPurchaseTokens}
                  disabled={loading}
                />
              ) : null}
            </HStack>

            {hints.length > 0 ? (
              <VStack gap="x2" alignItems="stretch">
                <Text textStyle="caption" color="fg.neutral-muted">
                  프롬프트 힌트
                </Text>
                <Flex wrap gap="x2">
                  {hints.map((hint) => (
                    <Chip
                      key={hint.id}
                      size="small"
                      variant="outline"
                      selected={prompt.includes(hint.prompt)}
                      disabled={disabled || loading}
                      onClick={() =>
                        handleHintSelect(hint, prompt.includes(hint.prompt))
                      }
                    >
                      {hint.label}
                    </Chip>
                  ))}
                </Flex>
              </VStack>
            ) : null}

            <VStack gap="x2" alignItems="stretch">
              <Text textStyle="caption" color="fg.neutral-muted">
                한 번에 만들 후보 수
              </Text>
              <HStack gap="x2" role="group" aria-label="후보 수">
                {CANDIDATE_COUNTS.map((count) => (
                  <Chip
                    key={count}
                    size="small"
                    selected={candidateCount === count}
                    disabled={disabled || loading}
                    onClick={() => onCandidateCountChange(count)}
                    aria-label={`후보 ${count}개`}
                  >
                    {count}개
                  </Chip>
                ))}
              </HStack>
            </VStack>

            <Flex justify="flex-end">
              <Text textStyle="captionSm" color="fg.neutral-subtle">
                잔액 {formatTokens(balance)}토큰 · 생성 1회{" "}
                {formatTokens(generateCost)}토큰
              </Text>
            </Flex>
          </VStack>
        ) : null}
      </VStack>
    </Box>
  );
}

function formatTokens(value: number | null | undefined) {
  return value == null ? "—" : krw.format(value);
}

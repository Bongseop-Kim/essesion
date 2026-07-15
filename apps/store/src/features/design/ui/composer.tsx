import {
  ActionButton,
  Box,
  Chip,
  Flex,
  HStack,
  Icon,
  Text,
  TextAreaField,
  VStack,
} from "@essesion/shared";
import { CreditCardIcon, PaperAirplaneIcon } from "@heroicons/react/24/outline";
import type { FormEvent } from "react";

import { krw } from "@/shared/lib/format";

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
}: DesignComposerProps) {
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
      <VStack gap="x4" alignItems="stretch">
        <TextAreaField
          label="어떤 디자인을 만들까요?"
          description="색상, 무늬, 분위기를 구체적으로 알려 주세요."
          placeholder="예: 짙은 네이비 바탕에 작은 실버 도트가 반복되는 클래식 패턴"
          value={prompt}
          onChange={(event) => onPromptChange(event.currentTarget.value)}
          autoResize
          rows={3}
          disabled={disabled || loading}
        />

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

        <Flex
          direction={{ base: "column", sm: "row" }}
          align={{ base: "stretch", sm: "center" }}
          justify="space-between"
          gap="x3"
        >
          <VStack gap="x0_5" alignItems="stretch">
            <Text textStyle="caption" color="fg.neutral-muted">
              잔액 {formatTokens(balance)}토큰
            </Text>
            <Text textStyle="captionSm" color="fg.neutral-subtle">
              생성 1회 {formatTokens(generateCost)}토큰
            </Text>
          </VStack>

          <HStack gap="x2" justify="flex-end">
            {onPurchaseTokens ? (
              <ActionButton
                type="button"
                variant="ghost"
                size="small"
                onClick={onPurchaseTokens}
                disabled={loading}
              >
                <Icon svg={<CreditCardIcon />} size={16} />
                충전
              </ActionButton>
            ) : null}
            <ActionButton
              type="submit"
              size="large"
              loading={loading}
              disabled={submitDisabled}
            >
              <Icon svg={<PaperAirplaneIcon />} size={20} />
              {submitLabel}
            </ActionButton>
          </HStack>
        </Flex>
      </VStack>
    </Box>
  );
}

function formatTokens(value: number | null | undefined) {
  return value == null ? "—" : krw.format(value);
}

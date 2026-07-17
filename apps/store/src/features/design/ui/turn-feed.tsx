import type { DesignTurnOut } from "@essesion/api-client";
import {
  ActionButton,
  Box,
  ContentPlaceholder,
  Icon,
  Text,
  VStack,
} from "@essesion/shared";
import {
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
} from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { svgToDataUri } from "../model/svg-preview";
import {
  type DesignTurnPayload,
  parseDesignTurnPayload,
} from "../model/turn-payload";
import { localizeDesignWarnings } from "../model/warnings";
import {
  CandidateGrid,
  CandidateGridSkeleton,
  type DesignCandidate,
} from "./candidate-grid";

type GeneratePayload = Extract<DesignTurnPayload, { type: "generate" }>;
export type TurnCandidate = GeneratePayload["response"]["candidates"][number];
export type FinalizeTurnPayload = Extract<
  DesignTurnPayload,
  { type: "finalize" }
>;

export type TurnFeedProps = {
  turns: readonly DesignTurnOut[];
  selectedCandidateId?: string | null;
  loading?: boolean;
  generating?: boolean;
  error?: boolean;
  selectionLoading?: boolean;
  onRetry?: () => void;
  onSelectCandidate: (
    candidate: TurnCandidate,
    intents: GeneratePayload["response"]["intents"],
  ) => void;
  renderFinalizeTurn: (payload: FinalizeTurnPayload) => ReactNode;
};

export function TurnFeed({
  turns,
  selectedCandidateId,
  loading = false,
  generating = false,
  error = false,
  selectionLoading = false,
  onRetry,
  onSelectCandidate,
  renderFinalizeTurn,
}: TurnFeedProps) {
  if (loading) {
    return (
      <VStack gap="x4" alignItems="stretch" px="x4" py="x5">
        <CandidateGridSkeleton />
      </VStack>
    );
  }

  if (error) {
    return (
      <ContentPlaceholder
        title="세션 기록을 불러오지 못했어요"
        description="잠시 후 다시 시도해 주세요."
        action={
          onRetry ? (
            <ActionButton
              type="button"
              size="small"
              variant="neutralOutline"
              onClick={onRetry}
            >
              <Icon svg={<ArrowPathIcon />} size={18} />
              다시 시도
            </ActionButton>
          ) : undefined
        }
      />
    );
  }

  if (turns.length === 0 && !generating) {
    return (
      <ContentPlaceholder
        icon={<Icon svg={<ChatBubbleLeftRightIcon />} size={32} />}
        title="첫 디자인을 만들어 보세요"
        description="색상, 무늬와 분위기를 설명하면 반복 가능한 패턴을 제안해 드려요."
      />
    );
  }

  return (
    <VStack
      as="ol"
      gap="x5"
      alignItems="stretch"
      px="x4"
      py="x5"
      aria-live="polite"
    >
      {turns.map((turn) => {
        const payload = parseDesignTurnPayload(turn.payload);
        if (payload?.type === "select") return null;
        return (
          <Box as="li" key={turn.id}>
            <TurnItem
              payload={payload}
              selectedCandidateId={selectedCandidateId}
              selectionLoading={selectionLoading}
              onSelectCandidate={onSelectCandidate}
              renderFinalizeTurn={renderFinalizeTurn}
            />
          </Box>
        );
      })}
      {generating ? (
        <Box as="li">
          <CandidateGridSkeleton />
        </Box>
      ) : null}
    </VStack>
  );
}

function TurnItem({
  payload,
  selectedCandidateId,
  selectionLoading,
  onSelectCandidate,
  renderFinalizeTurn,
}: {
  payload: DesignTurnPayload | null;
  selectedCandidateId?: string | null;
  selectionLoading: boolean;
  onSelectCandidate: TurnFeedProps["onSelectCandidate"];
  renderFinalizeTurn: TurnFeedProps["renderFinalizeTurn"];
}) {
  if (!payload) {
    return (
      <Text textStyle="caption" color="fg.neutral-subtle">
        표시할 수 없는 이전 기록이에요.
      </Text>
    );
  }

  if (payload.type === "generate_request") {
    return (
      <VStack alignItems="flex-end" gap="x1">
        <Box
          maxWidth="85%"
          borderRadius="r4"
          bg="bg.brand-weak"
          px="x4"
          py="x3"
        >
          <Text textStyle="bodySm">
            {payload.mode === "variation"
              ? "선택한 디자인의 배리에이션을 만들어 주세요."
              : payload.prompt || "새 디자인을 만들어 주세요."}
          </Text>
        </Box>
        <Text textStyle="captionSm" color="fg.neutral-subtle">
          후보 {payload.candidate_count}개
        </Text>
      </VStack>
    );
  }

  if (payload.type === "generate") {
    const candidates: DesignCandidate[] = payload.response.candidates.map(
      (candidate, index) => ({
        id: candidate.id,
        imageSrc: svgToDataUri(candidate.svg),
        alt: `AI 디자인 후보 ${index + 1}`,
      }),
    );
    return (
      <CandidateGrid
        candidates={candidates}
        selectedId={selectedCandidateId}
        warnings={localizeDesignWarnings(payload.response.warnings)}
        disabled={selectionLoading}
        onSelect={(selected) => {
          const candidate = payload.response.candidates.find(
            (item) => item.id === selected.id,
          );
          if (!candidate) return;
          if (payload.response.intents[candidate.design_index])
            onSelectCandidate(candidate, payload.response.intents);
        }}
      />
    );
  }

  if (payload.type === "finalize") return renderFinalizeTurn(payload);
  return null;
}

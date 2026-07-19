import type {
  DesignTurnAttachmentOut,
  DesignTurnOut,
} from "@essesion/api-client";
import {
  ActionButton,
  Box,
  ContentPlaceholder,
  Flex,
  HStack,
  Icon,
  ImageFrame,
  Text,
  VStack,
} from "@essesion/shared";
import {
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
} from "@heroicons/react/24/outline";
import type { MouseEvent, ReactNode } from "react";
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
  onRetry?: () => void;
  onSelectCandidate: (
    candidate: TurnCandidate,
    intents: GeneratePayload["response"]["intents"],
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
  renderFinalizeTurn: (payload: FinalizeTurnPayload) => ReactNode;
  /** 있으면 후보 타일 탭 시 앵커 메뉴로 노출할 항목들(CandidateGrid의 menu). */
  candidateMenu?: ReactNode;
};

export function TurnFeed({
  turns,
  selectedCandidateId,
  loading = false,
  generating = false,
  error = false,
  onRetry,
  onSelectCandidate,
  renderFinalizeTurn,
  candidateMenu,
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
      <FeedCenter>
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
      </FeedCenter>
    );
  }

  if (turns.length === 0 && !generating) {
    return (
      <FeedCenter>
        <ContentPlaceholder
          icon={<Icon svg={<ChatBubbleLeftRightIcon />} size={32} />}
          title="첫 디자인을 만들어 보세요"
          description="색상, 무늬와 분위기를 설명하면 반복 가능한 패턴을 제안해 드려요."
        />
      </FeedCenter>
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
              attachments={turn.attachments ?? []}
              selectedCandidateId={selectedCandidateId}
              onSelectCandidate={onSelectCandidate}
              renderFinalizeTurn={renderFinalizeTurn}
              candidateMenu={candidateMenu}
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

function FeedCenter({ children }: { children: ReactNode }) {
  return (
    <Flex direction="column" justify="center" minHeight="full" px="x4">
      {children}
    </Flex>
  );
}

function TurnItem({
  payload,
  attachments,
  selectedCandidateId,
  onSelectCandidate,
  renderFinalizeTurn,
  candidateMenu,
}: {
  payload: DesignTurnPayload | null;
  attachments: readonly DesignTurnAttachmentOut[];
  selectedCandidateId?: string | null;
  onSelectCandidate: TurnFeedProps["onSelectCandidate"];
  renderFinalizeTurn: TurnFeedProps["renderFinalizeTurn"];
  candidateMenu?: ReactNode;
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
      <VStack alignItems="flex-end" gap="x2">
        <Box
          maxWidth="85%"
          borderRadius="r4"
          bg="bg.brand-weak"
          px="x4"
          py="x3"
        >
          <Text textStyle="bodySm">
            {payload.mode === "variation"
              ? "선택한 디자인과 비슷하게 다시 만들어 주세요."
              : payload.prompt || "새 디자인을 만들어 주세요."}
          </Text>
        </Box>
        <Text textStyle="captionSm" color="fg.neutral-subtle">
          후보 {payload.candidate_count}개
        </Text>
        {attachments.length > 0 ? (
          <HStack gap="x2" wrap justify="flex-end" maxWidth="85%">
            {attachments.map((attachment, index) => {
              const src =
                attachment.kind === "svg" && attachment.preview_svg
                  ? svgToDataUri(attachment.preview_svg)
                  : attachment.preview_url;
              return (
                <VStack
                  key={`${attachment.kind}-${attachment.filename}-${index}`}
                  gap="x1"
                  alignItems="stretch"
                  width={64}
                >
                  <ImageFrame
                    ratio={1}
                    src={src ?? undefined}
                    alt={attachment.filename}
                    fit="contain"
                    stroke
                  />
                  <Text
                    textStyle="captionSm"
                    color="fg.neutral-subtle"
                    className="truncate"
                  >
                    {attachment.filename}
                  </Text>
                </VStack>
              );
            })}
          </HStack>
        ) : null}
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
        menu={candidateMenu}
        onSelect={(selected, event) => {
          const candidate = payload.response.candidates.find(
            (item) => item.id === selected.id,
          );
          // 후보·intent 복원 실패 시 메뉴 오픈도 함께 막는다.
          if (!candidate || !payload.response.intents[candidate.design_index]) {
            event.preventDefault();
            return;
          }
          onSelectCandidate(candidate, payload.response.intents, event);
        }}
      />
    );
  }

  if (payload.type === "finalize") return renderFinalizeTurn(payload);
  return null;
}

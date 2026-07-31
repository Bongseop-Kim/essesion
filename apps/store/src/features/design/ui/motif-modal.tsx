import {
  ActionButton,
  Box,
  Callout,
  Chip,
  ContentPlaceholder,
  Divider,
  Flex,
  Grid,
  HStack,
  Icon,
  ImageFrame,
  ResponsiveModal,
  Skeleton,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import {
  ArrowUpTrayIcon,
  BookmarkIcon,
  CameraIcon,
  ExclamationTriangleIcon,
  LanguageIcon,
  MagnifyingGlassIcon,
  PaintBrushIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { useRef } from "react";

import {
  DESIGN_PHOTO_ACCEPT,
  DESIGN_SVG_ACCEPT,
} from "@/features/design/api/attachments";
import { svgToDataUri } from "@/features/design/model/svg-preview";
import type {
  MotifCard,
  MotifSearchState,
} from "@/features/design/model/use-motif-search";

export type MotifModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: MotifSearchState;
  /** 유료 경로 — 이 모달을 닫고 생성 확인 모달을 띄운다(모달 위 모달 금지). */
  onRequestGenerate: () => void;
  /** 내 모티프 카드 삭제 — 확인 다이얼로그는 오버레이 레이어가 소유한다. */
  onDeleteMotif: (motif: { id: string; name: string }) => void;
};

/**
 * 모티프 하나뿐인 모달. 기본 경로는 목록이 아니라 문장 → 검색이고, 무료 경로(검색·SVG·
 * 사진·글자·내 모티프)가 먼저, 유료 생성이 맨 아래 한 줄이다 — 순서가 비용 안내다.
 */
export function MotifModal({
  open,
  onOpenChange,
  state,
  onRequestGenerate,
  onDeleteMotif,
}: MotifModalProps) {
  const svgInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const library = state.source === "library";
  const canConfirm = !!state.selected && !state.selected.current;

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => {
        if (!next && state.working) return;
        onOpenChange(next);
      }}
      title="모티프 바꾸기"
      description="어떤 그림을 넣을지 알려주세요."
      size="medium"
      showCloseButton={!state.working}
      closeOnEscape={!state.working}
      footer={
        <HStack gap="x2">
          <Box
            as={ActionButton}
            type="button"
            variant="neutralOutline"
            width="full"
            disabled={state.working}
            onClick={() => onOpenChange(false)}
          >
            취소
          </Box>
          <Box
            as={ActionButton}
            type="button"
            width="full"
            loading={state.working}
            disabled={!canConfirm}
            onClick={() => void state.confirm()}
          >
            이 그림으로 바꾸기
          </Box>
        </HStack>
      }
    >
      <VStack gap="x4" alignItems="stretch">
        <TextField
          aria-label="어떤 그림을 넣을지"
          placeholder="예: 작은 벌"
          value={state.query}
          maxLength={100}
          prefix={<Icon svg={<MagnifyingGlassIcon />} size={20} />}
          onChange={(event) => state.setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void state.search();
          }}
        />

        <VStack gap="x2" alignItems="stretch">
          <HStack gap="x2">
            <Text as="h3" textStyle="labelSm">
              {library ? "내 모티프" : "비슷한 모티프"}
            </Text>
            <Text textStyle="captionSm" color="fg.neutral-subtle">
              추가 비용 없음
            </Text>
          </HStack>
          <MotifResultGrid
            state={state}
            onDeleteMotif={onDeleteMotif}
            onRetry={state.refetchLibrary}
          />
        </VStack>

        <Divider />

        <HStack
          gap="x3"
          p="x3"
          borderWidth={1}
          borderColor="stroke.neutral-weak"
          borderRadius="r3"
        >
          <Icon svg={<PaintBrushIcon />} size={20} />
          <VStack gap="x1" alignItems="stretch" minWidth={0}>
            <Text textStyle="labelSm">원하는 모양이 없나요?</Text>
            <Text textStyle="captionSm" color="fg.neutral-subtle">
              {state.exhausted
                ? "이번 디자인에서 더 만들 수 없어요"
                : state.remaining === null
                  ? "문장 그대로 새로 만들어요"
                  : `문장 그대로 새로 만들어요 · ${state.remaining}번 더 가능`}
            </Text>
          </VStack>
          <Box ml="auto">
            <ActionButton
              type="button"
              size="small"
              variant="neutralWeak"
              disabled={!state.query.trim() || state.exhausted || state.working}
              onClick={onRequestGenerate}
            >
              새로 만들기
            </ActionButton>
          </Box>
        </HStack>

        <Flex wrap="wrap" gap="x2">
          <Chip
            size="small"
            variant="outline"
            disabled={state.working}
            prefix={<Icon svg={<ArrowUpTrayIcon />} size={16} />}
            onClick={() => svgInput.current?.click()}
          >
            SVG 올리기
          </Chip>
          <Chip
            size="small"
            variant="outline"
            disabled={state.working}
            prefix={<Icon svg={<CameraIcon />} size={16} />}
            onClick={() => photoInput.current?.click()}
          >
            사진에서 따오기
          </Chip>
          <Chip
            size="small"
            variant="outline"
            disabled={state.working || !state.query.trim()}
            prefix={<Icon svg={<LanguageIcon />} size={16} />}
            onClick={() => void state.addText()}
          >
            글자로 만들기
          </Chip>
          <Chip
            size="small"
            variant="outline"
            selected={library}
            disabled={state.working}
            prefix={<Icon svg={<BookmarkIcon />} size={16} />}
            onClick={() => state.setSource(library ? "search" : "library")}
          >
            내 모티프
          </Chip>
        </Flex>

        {state.warnings.length > 0 ? (
          <Callout
            tone="warning"
            title="만든 그림 안내"
            description={state.warnings.join(" ")}
          />
        ) : null}
        {state.error ? (
          <Callout
            tone="critical"
            title="그림을 준비하지 못했습니다"
            description={state.error}
          />
        ) : null}

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
            if (file) void state.addSvgFile(file);
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
            if (file) void state.addPhotoFile(file);
          }}
        />
      </VStack>
    </ResponsiveModal>
  );
}

function MotifResultGrid({
  state,
  onDeleteMotif,
  onRetry,
}: {
  state: MotifSearchState;
  onDeleteMotif: (motif: { id: string; name: string }) => void;
  onRetry: () => void;
}) {
  const library = state.source === "library";
  if (state.searching || state.libraryLoading) {
    return (
      <Grid
        columns={{ base: 3, md: 4 }}
        gap="x2"
        aria-busy="true"
        aria-label="모티프 불러오는 중"
      >
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} height={92} radius="r2" />
        ))}
      </Grid>
    );
  }
  if (state.libraryError) {
    return (
      <ContentPlaceholder
        icon={<Icon svg={<ExclamationTriangleIcon />} size={32} />}
        title="내 모티프를 불러오지 못했어요"
        description="잠시 후 다시 시도해 주세요."
        action={
          <ActionButton
            type="button"
            size="small"
            variant="neutralWeak"
            onClick={onRetry}
          >
            다시 시도
          </ActionButton>
        }
      />
    );
  }
  if (state.cards.length === 0) {
    const empty = library
      ? {
          title: "저장한 모티프가 없어요",
          description: "SVG·사진·글자로 만든 그림이 여기에 모여요.",
        }
      : state.searched
        ? {
            title: "찾은 그림이 없어요",
            description: "다르게 적어 보거나 아래에서 새로 만들어 보세요.",
          }
        : {
            title: "넣을 그림을 문장으로 알려주세요",
            description: "예: 작은 벌 · 엔터를 누르면 찾아요.",
          };
    return (
      <ContentPlaceholder
        icon={<Icon svg={<MagnifyingGlassIcon />} size={32} />}
        title={empty.title}
        description={empty.description}
      />
    );
  }
  return (
    <Grid columns={{ base: 3, md: 4 }} gap="x2">
      {state.cards.map((card) => {
        const userMotifId = card.userMotifId;
        return (
          <MotifResultCard
            key={card.key}
            card={card}
            selected={state.selectedKey === card.key}
            disabled={state.working}
            onSelect={() => state.setSelectedKey(card.key)}
            onDelete={
              userMotifId
                ? () => onDeleteMotif({ id: userMotifId, name: card.name })
                : undefined
            }
          />
        );
      })}
    </Grid>
  );
}

function MotifResultCard({
  card,
  selected,
  disabled,
  onSelect,
  onDelete,
}: {
  card: MotifCard;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  return (
    <VStack gap="x1" alignItems="stretch">
      <Box
        as="button"
        type="button"
        borderWidth={1}
        borderColor={selected ? "stroke.brand" : "stroke.neutral-weak"}
        bg={selected ? "bg.brand-weak" : "bg.layer-default"}
        borderRadius="r2"
        p="x1"
        aria-pressed={selected}
        aria-label={`${card.name} 고르기`}
        disabled={disabled}
        onClick={onSelect}
        className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring disabled:pointer-events-none disabled:opacity-50"
      >
        <ImageFrame
          ratio={1}
          borderRadius="r2"
          fit="contain"
          src={card.previewSvg ? svgToDataUri(card.previewSvg) : undefined}
          alt=""
        />
      </Box>
      <HStack gap="x1">
        <Text textStyle="captionSm" maxLines={1} minWidth={0}>
          {card.name}
        </Text>
        {onDelete ? (
          <Box ml="auto">
            <ActionButton
              type="button"
              size="xsmall"
              variant="ghost"
              iconOnly
              aria-label={`${card.name} 모티프 삭제`}
              disabled={disabled}
              onClick={onDelete}
            >
              <Icon svg={<TrashIcon />} size={14} />
            </ActionButton>
          </Box>
        ) : null}
      </HStack>
    </VStack>
  );
}

import {
  ActionButton,
  Box,
  Callout,
  Chip,
  ContentPlaceholder,
  FieldButton,
  Flex,
  Grid,
  HStack,
  Icon,
  ImageFrame,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
  ProgressCircle,
  ResponsiveModal,
  SegmentedControl,
  SegmentedControlItem,
  Skeleton,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import {
  ExclamationTriangleIcon,
  LanguageIcon,
  MagnifyingGlassIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { useRef } from "react";

import { DESIGN_PHOTO_ACCEPT } from "@/features/design/api/attachments";
import { svgToDataUri } from "@/features/design/model/svg-preview";
import type {
  MotifCard,
  MotifFontId,
  MotifSearchState,
  MotifSource,
} from "@/features/design/model/use-motif-search";

export type MotifModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: MotifSearchState;
  /** 내 모티프 카드 삭제 — 확인 다이얼로그는 오버레이 레이어가 소유한다. */
  onDeleteMotif: (motif: { id: string; name: string }) => void;
};

/** 소스 하나 = 화면 하나. 다른 방법으로 바꾸려면 닫고 슬롯을 다시 누른다. */
const HEADERS: Record<
  MotifSource,
  { title: string; hint: (slot: 1 | 2) => string; size: "small" | "medium" }
> = {
  search: {
    title: "탐색",
    hint: (slot) => `슬롯 ${slot}에 넣을 그림을 문장으로 찾아요.`,
    size: "medium",
  },
  library: {
    title: "내 모티프",
    hint: (slot) => `슬롯 ${slot}에 넣을 그림을 저장한 목록에서 골라요.`,
    size: "medium",
  },
  generate: {
    title: "AI 생성",
    hint: (slot) => `슬롯 ${slot}에 넣을 그림을 문장 그대로 새로 만들어요.`,
    size: "small",
  },
  text: {
    title: "글자 넣기",
    hint: (slot) => `슬롯 ${slot}에 넣을 글자를 그림으로 만들어요.`,
    size: "small",
  },
  photo: {
    title: "사진에서 따오기",
    hint: (slot) =>
      `사진에서 배경을 지우고 색면을 정리해 슬롯 ${slot}에 넣어요.`,
    size: "small",
  },
};

const GENERATE_EXAMPLES = ["작은 벌", "네잎클로버", "종이비행기"];
const MAX_MOTIF_QUERY_LENGTH = 200;

const fileSize = (bytes: number) =>
  bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1000))}KB`;

const FONTS: { id: MotifFontId; name: string; hint: string }[] = [
  { id: "nanum-gothic", name: "나눔고딕", hint: "반듯하고 잘 읽혀요" },
  { id: "nanum-myeongjo", name: "나눔명조", hint: "붓 느낌의 세리프예요" },
];

export function MotifModal({
  open,
  onOpenChange,
  state,
  onDeleteMotif,
}: MotifModalProps) {
  const header = HEADERS[state.source];

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => {
        if (!next && state.working) return;
        onOpenChange(next);
      }}
      title={header.title}
      description={header.hint(state.slot)}
      size={header.size}
      showCloseButton={!state.working}
      closeOnEscape={!state.working}
      footer={<ModalFooter state={state} onClose={() => onOpenChange(false)} />}
    >
      {state.source === "search" ? (
        <SearchBody state={state} />
      ) : state.source === "library" ? (
        <VStack gap="x4" alignItems="stretch">
          <MotifResultGrid state={state} onDeleteMotif={onDeleteMotif} />
          <ErrorCallout message={state.error} />
        </VStack>
      ) : state.source === "generate" ? (
        <GenerateBody state={state} />
      ) : state.source === "text" ? (
        <TextBody state={state} />
      ) : (
        <PhotoBody state={state} />
      )}
    </ResponsiveModal>
  );
}

function ModalFooter({
  state,
  onClose,
}: {
  state: MotifSearchState;
  onClose: () => void;
}) {
  if (state.source === "search" || state.source === "library") {
    return (
      <Box
        as={ActionButton}
        type="button"
        width="full"
        loading={state.working}
        disabled={!state.selected || state.selected.current}
        onClick={() => void state.confirm()}
      >
        이 그림으로 바꾸기
      </Box>
    );
  }
  if (state.source === "generate") {
    if (!state.generated) {
      return (
        <Box
          as={ActionButton}
          type="button"
          width="full"
          loading={state.working}
          disabled={!state.generatePrompt.trim() || state.exhausted}
          onClick={() => void state.generate()}
        >
          이 문장으로 만들기
        </Box>
      );
    }
    return (
      <HStack gap="x2">
        <Box
          as={ActionButton}
          type="button"
          variant="neutralOutline"
          width="full"
          loading={state.busySource === "generate"}
          disabled={state.working || state.exhausted}
          onClick={() => void state.generate()}
        >
          {state.remaining === null
            ? "다시 만들기"
            : `다시 만들기 · ${state.remaining}번`}
        </Box>
        <Box
          as={ActionButton}
          type="button"
          width="full"
          loading={state.busySource === "confirm"}
          disabled={state.working}
          onClick={() => void state.applyGenerated()}
        >
          이 그림 적용
        </Box>
      </HStack>
    );
  }
  if (state.source === "text") {
    return (
      <Box
        as={ActionButton}
        type="button"
        width="full"
        loading={state.working}
        disabled={!state.textResult}
        onClick={() => void state.applyText()}
      >
        이 그림 적용
      </Box>
    );
  }
  // 사진 — 배경 제거 결과는 사진마다 갈려서 여기만 두 버튼이다.
  return (
    <HStack gap="x2">
      <Box
        as={ActionButton}
        type="button"
        variant="neutralOutline"
        width="full"
        disabled={state.working}
        onClick={onClose}
      >
        취소
      </Box>
      <Box
        as={ActionButton}
        type="button"
        width="full"
        loading={state.working}
        disabled={!state.photoResult?.svg}
        onClick={() => void state.confirmPhoto()}
      >
        확정
      </Box>
    </HStack>
  );
}

function SearchBody({ state }: { state: MotifSearchState }) {
  return (
    <VStack gap="x4" alignItems="stretch">
      <TextField
        aria-label="어떤 그림을 넣을지"
        placeholder="예: 작은 벌"
        value={state.query}
        maxLength={MAX_MOTIF_QUERY_LENGTH}
        description="카탈로그에서 고르는 건 추가 비용이 없어요"
        prefix={<Icon svg={<MagnifyingGlassIcon />} size={20} />}
        suffix={
          <ActionButton
            type="button"
            size="xsmall"
            variant="neutralWeak"
            disabled={!state.query.trim() || state.working}
            onClick={() => void state.search()}
          >
            찾기
          </ActionButton>
        }
        onChange={(event) => state.setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          void state.search();
        }}
      />
      <MotifResultGrid state={state} />
      <ErrorCallout message={state.error} />
    </VStack>
  );
}

function GenerateBody({ state }: { state: MotifSearchState }) {
  const generating = state.busySource === "generate";
  return (
    <VStack gap="x4" alignItems="stretch">
      <TextField
        aria-label="새로 만들 그림"
        placeholder="예: 작은 벌"
        value={state.generatePrompt}
        maxLength={MAX_MOTIF_QUERY_LENGTH}
        disabled={state.working || state.exhausted}
        description={
          state.exhausted
            ? "이번 디자인에서 더 만들 수 없어요"
            : state.remaining === null
              ? `${state.generatePrompt.length}/${MAX_MOTIF_QUERY_LENGTH}`
              : `이번 디자인에서 ${state.remaining}번 더 만들 수 있어요 · ${state.generatePrompt.length}/${MAX_MOTIF_QUERY_LENGTH}`
        }
        onChange={(event) => state.setGeneratePrompt(event.currentTarget.value)}
      />

      {!state.generated && !state.working && !state.exhausted ? (
        <>
          <Flex wrap="wrap" gap="x2">
            {GENERATE_EXAMPLES.map((example) => (
              <Chip
                key={example}
                type="button"
                size="small"
                variant="outline"
                selected={state.generatePrompt === example}
                onClick={() => state.setGeneratePrompt(example)}
              >
                {example}
              </Chip>
            ))}
          </Flex>
          <VStack gap="x1" alignItems="stretch">
            <Text textStyle="labelSm">잘 나오는 문장</Text>
            {[
              "사물 하나만 적어요",
              "단순한 형태일수록 잘 나와요",
              "그림체는 지금 디자인을 따라가요",
            ].map((tip) => (
              <Text key={tip} textStyle="captionSm" color="fg.neutral-subtle">
                · {tip}
              </Text>
            ))}
          </VStack>
        </>
      ) : null}

      {generating ? (
        <BusyBlock message="그림을 그리고 있어요 · 20초쯤 걸려요 · 끝날 때까지 열어 두세요" />
      ) : null}

      {state.generateError ? (
        <Callout
          tone="critical"
          title="그림을 만들지 못했어요"
          description={state.generateError}
        />
      ) : null}

      {state.generated ? (
        <VStack gap="x2" alignItems="stretch">
          <ResultPreview svg={state.generated.previewSvg} alt="만든 그림" />
          <Text textStyle="captionSm" color="fg.neutral-subtle" align="center">
            {state.generated.saved
              ? "내 모티프에 저장했어요 — 적용하지 않아도 나중에 다시 고를 수 있어요"
              : "내 모티프가 가득 차 저장하지 못했어요"}
          </Text>
        </VStack>
      ) : null}
    </VStack>
  );
}

function TextBody({ state }: { state: MotifSearchState }) {
  const font = FONTS.find((item) => item.id === state.fontId);
  return (
    <VStack gap="x4" alignItems="stretch">
      <TextField
        aria-label="넣을 글자"
        placeholder="예: 영선"
        value={state.text}
        maxLength={20}
        disabled={state.working}
        description={`추가 비용 없이 몇 번이든 · ${state.text.length}/20`}
        prefix={<Icon svg={<LanguageIcon />} size={20} />}
        suffix={
          <ActionButton
            type="button"
            size="xsmall"
            variant="neutralWeak"
            disabled={!state.text.trim() || state.working}
            onClick={() => void state.addText()}
          >
            만들기
          </ActionButton>
        }
        onChange={(event) => state.setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          void state.addText();
        }}
      />

      <HStack gap="x2" alignItems="flex-end">
        <Box flex={1} minWidth={0}>
          <MenuRoot>
            <MenuTrigger>
              <FieldButton
                aria-label="글꼴"
                value={font?.name}
                disabled={state.working}
              />
            </MenuTrigger>
            <MenuContent aria-label="글꼴 고르기">
              {FONTS.map((item) => (
                <MenuItem
                  key={item.id}
                  label={item.name}
                  description={item.hint}
                  checked={item.id === state.fontId}
                  onClick={() => state.changeFont(item.id)}
                />
              ))}
            </MenuContent>
          </MenuRoot>
        </Box>
        <SegmentedControl
          aria-label="굵기"
          value={String(state.fontWeight)}
          onValueChange={(value) =>
            state.changeFontWeight(value === "700" ? 700 : 400)
          }
        >
          <SegmentedControlItem value="400" disabled={state.working}>
            보통
          </SegmentedControlItem>
          <SegmentedControlItem value="700" disabled={state.working}>
            굵게
          </SegmentedControlItem>
        </SegmentedControl>
      </HStack>

      {state.busySource === "text" ? (
        <BusyBlock message="글자를 그리고 있어요" />
      ) : null}
      {state.textResult ? (
        <ResultPreview svg={state.textResult.svg} alt="만든 글자 그림" />
      ) : null}
      <WarningText warnings={state.warnings} />
      <ErrorCallout message={state.error} />
    </VStack>
  );
}

function PhotoBody({ state }: { state: MotifSearchState }) {
  const photoInput = useRef<HTMLInputElement>(null);
  const photo = state.photoResult;

  return (
    <VStack gap="x4" alignItems="stretch">
      <HStack
        gap="x3"
        p="x3"
        borderWidth={1}
        borderColor="stroke.neutral-weak"
        borderRadius="r3"
      >
        <Box width={48}>
          <ImageFrame
            ratio={1}
            borderRadius="r2"
            stroke
            src={photo?.sourceUrl}
            alt=""
          />
        </Box>
        <VStack gap="x0_5" alignItems="stretch" minWidth={0}>
          <Text textStyle="labelSm" maxLines={1}>
            {photo?.name ?? "사진을 고르지 않았어요"}
          </Text>
          <Text textStyle="captionSm" color="fg.neutral-subtle">
            {photo ? fileSize(photo.sizeBytes) : "10MB 이하 사진"}
          </Text>
        </VStack>
        <Box ml="auto">
          <ActionButton
            type="button"
            size="small"
            variant="neutralOutline"
            disabled={state.working}
            onClick={() => photoInput.current?.click()}
          >
            {photo ? "다른 사진" : "사진 고르기"}
          </ActionButton>
        </Box>
      </HStack>

      {state.busySource === "photo" ? (
        <BusyBlock message="배경을 지우고 있어요 · 10초쯤 걸려요" />
      ) : null}

      {photo?.svg ? (
        <VStack gap="x2" alignItems="stretch">
          <Grid columns={2} gap="x2">
            <ComparePane label="사진" src={photo.sourceUrl} />
            <ComparePane label="배경 제거" src={svgToDataUri(photo.svg)} />
          </Grid>
          <Text textStyle="captionSm" color="fg.neutral-subtle" align="center">
            배경을 지우고 가까운 중간색을 정리했어요
          </Text>
          <WarningText warnings={state.warnings} />
        </VStack>
      ) : null}

      <ErrorCallout message={state.error} />

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
  );
}

function ComparePane({ label, src }: { label: string; src: string }) {
  return (
    <VStack gap="x1" alignItems="stretch">
      <ImageFrame ratio={1} borderRadius="r2" stroke fit="contain" src={src} />
      <Text textStyle="captionSm" color="fg.neutral-subtle" align="center">
        {label}
      </Text>
    </VStack>
  );
}

function ResultPreview({ svg, alt }: { svg: string; alt: string }) {
  return (
    <Box width={180} alignSelf="center">
      <ImageFrame
        ratio={1}
        borderRadius="r2"
        stroke
        fit="contain"
        src={svgToDataUri(svg)}
        alt={alt}
      />
    </Box>
  );
}

function BusyBlock({ message }: { message: string }) {
  return (
    <HStack
      gap="x3"
      p="x3"
      bg="bg.neutral-weak"
      borderRadius="r3"
      aria-busy="true"
    >
      <ProgressCircle size={24} />
      <Text textStyle="captionSm" color="fg.neutral-subtle">
        {message}
      </Text>
    </HStack>
  );
}

function WarningText({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) return null;
  return (
    <Text textStyle="captionSm" color="fg.warning">
      {warnings.join(" ")}
    </Text>
  );
}

function ErrorCallout({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Callout
      tone="critical"
      title="그림을 준비하지 못했어요"
      description={message}
    />
  );
}

function MotifResultGrid({
  state,
  onDeleteMotif,
}: {
  state: MotifSearchState;
  onDeleteMotif?: (motif: { id: string; name: string }) => void;
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
        title="내 모티프를 불러오지 못했어요"
        description="잠시 후 다시 시도해 주세요."
        icon={<Icon svg={<ExclamationTriangleIcon />} size={32} />}
        action={
          <ActionButton
            type="button"
            size="small"
            variant="neutralWeak"
            onClick={state.refetchLibrary}
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
          description: "만든 그림은 여기에 모여요.",
        }
      : state.searched
        ? {
            title: "찾은 그림이 없어요",
            description: "다르게 적어 보거나 닫고 다른 방법을 골라 보세요.",
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
            key={card.motifId}
            card={card}
            selected={state.selectedId === card.motifId}
            disabled={state.working}
            onSelect={() => state.setSelectedId(card.motifId)}
            onDelete={
              userMotifId && onDeleteMotif
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

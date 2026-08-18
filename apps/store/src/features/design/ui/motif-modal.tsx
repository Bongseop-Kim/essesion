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
  Modal,
  ProgressCircle,
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
import { MOTIF_CATEGORIES } from "@/features/design/model/motif-categories";
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
  /** 새 모티프 1회 단가 — 누르는 자리에서 과금액을 보여준다(money.md §6). */
  motifGenerateCost: number | null;
};

/**
 * 소스 하나 = 화면 하나. 다른 방법으로 바꾸려면 닫고 슬롯을 다시 누른다.
 * `hint`의 `{slot}`은 렌더에서 슬롯 번호로 바뀐다 — 탐색·AI 생성은 입력창과 버튼 문구가
 * 이미 무엇을 하는 화면인지 말하므로 설명이 없다.
 */
const HEADERS: Record<
  MotifSource,
  { title: string; hint?: string; size: "small" | "medium" }
> = {
  search: { title: "탐색", size: "medium" },
  library: {
    title: "내 모티프",
    hint: "슬롯 {slot}에 넣을 그림을 저장한 목록에서 골라요.",
    size: "medium",
  },
  generate: { title: "AI 생성", size: "small" },
  text: { title: "글자 넣기", size: "small" },
  photo: { title: "사진에서 따오기", size: "small" },
};

const GENERATE_EXAMPLES = ["작은 벌", "네잎클로버", "종이비행기"];
const MAX_MOTIF_QUERY_LENGTH = 200;

/** 배경 분리가 되는 조건을 고르기 전에 말해 준다 — 워커는 평면 배경만 오려낼 수 있다. */
const PHOTO_TIPS = [
  "배경이 흰색처럼 한 가지 색인 사진",
  "그림 하나만 가운데 있고 테두리까지 배경이 이어진 사진",
  "형태가 또렷하고 색이 적은 것 — 로고·자수·아이콘",
  "풍경·인물 사진은 배경을 지울 수 없어요",
];

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
  motifGenerateCost,
}: MotifModalProps) {
  const header = HEADERS[state.source];

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next && state.working) return;
        onOpenChange(next);
      }}
      title={header.title}
      description={header.hint?.replace("{slot}", String(state.slot))}
      size={header.size}
      showCloseButton={!state.working}
      closeOnEscape={!state.working}
      footer={
        <ModalFooter state={state} motifGenerateCost={motifGenerateCost} />
      }
    >
      {/* 본문 하나 = 소스 하나. 각 Body가 자기 스택(alignItems="stretch")을 소유한다. */}
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
    </Modal>
  );
}

function ModalFooter({
  state,
  motifGenerateCost,
}: {
  state: MotifSearchState;
  motifGenerateCost: number | null;
}) {
  // 사진 소스의 파일 선택창 — 푸터가 액션을 소유하므로 input도 여기 산다.
  const photoInput = useRef<HTMLInputElement>(null);
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
    const cost = motifGenerateCost == null ? "" : ` · ${motifGenerateCost}토큰`;
    if (!state.generated) {
      return (
        <Box
          as={ActionButton}
          type="button"
          width="full"
          loading={state.working}
          disabled={!state.generatePrompt.trim()}
          onClick={() => void state.generate()}
        >
          이 문장으로 만들기{cost}
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
          disabled={state.working}
          onClick={() => void state.generate()}
        >
          다시 만들기{cost}
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
    if (!state.textResult) {
      return (
        <Box
          as={ActionButton}
          type="button"
          width="full"
          loading={state.working}
          disabled={!state.text.trim()}
          onClick={() => void state.addText()}
        >
          이 글자로 만들기
        </Box>
      );
    }
    // 글꼴·굵기는 결과를 그대로 다시 그리므로 "다시 만들기"가 아니라 입력으로 되돌리는 문이다.
    return (
      <HStack gap="x2">
        <Box
          as={ActionButton}
          type="button"
          variant="neutralOutline"
          width="full"
          disabled={state.working}
          onClick={state.discardText}
        >
          이전
        </Box>
        <Box
          as={ActionButton}
          type="button"
          width="full"
          loading={state.working}
          onClick={() => void state.applyText()}
        >
          이 그림 적용
        </Box>
      </HStack>
    );
  }
  // 사진 — 입력이 파일 선택창이라 "다시 고르기"는 글자 모달의 입력 수정에 해당한다.
  const pick = () => photoInput.current?.click();
  return (
    <>
      {state.photoResult?.svg ? (
        <HStack gap="x2">
          <Box
            as={ActionButton}
            type="button"
            variant="neutralOutline"
            width="full"
            disabled={state.working}
            onClick={pick}
          >
            다른 사진
          </Box>
          <Box
            as={ActionButton}
            type="button"
            width="full"
            loading={state.working}
            onClick={() => void state.confirmPhoto()}
          >
            이 그림 적용
          </Box>
        </HStack>
      ) : (
        <Box
          as={ActionButton}
          type="button"
          width="full"
          loading={state.working}
          onClick={pick}
        >
          {state.photoResult ? "다른 사진 고르기" : "사진 고르기"}
        </Box>
      )}
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
    </>
  );
}

function SearchBody({ state }: { state: MotifSearchState }) {
  return (
    <VStack gap={0} alignItems="stretch">
      {/* 결과가 길어져도 검색창은 위에 붙어 있는다 — 스크롤을 가진 건 Modal 본문 Box이고,
          아래로 지나가는 그리드를 가리려면 모달과 같은 면 색이 필요하다. 칩은 11개라
          같이 붙이면 모바일에서 본문 절반을 먹어 스크롤에 맡긴다. */}
      <Box position="sticky" top={0} zIndex={1} pb="x4" bg="bg.layer-floating">
        {/* 찾기 버튼은 없다 — 타이핑이 멎으면 훅이 디바운스로 찾는다. */}
        <TextField
          aria-label="어떤 그림을 넣을지"
          placeholder="예: 작은 벌"
          value={state.query}
          maxLength={MAX_MOTIF_QUERY_LENGTH}
          prefix={<Icon svg={<MagnifyingGlassIcon />} size={20} />}
          onChange={(event) => state.setQuery(event.currentTarget.value)}
        />
      </Box>
      <VStack gap="x4" alignItems="stretch">
        <CategoryChips state={state} />
        <MotifResultGrid state={state} />
        <ErrorCallout message={state.error} />
      </VStack>
    </VStack>
  );
}

/**
 * 카탈로그가 100개 남짓이라 검색보다 훑는 게 빠르다 — 라벨이 그대로 검색어다.
 * 가로 스크롤 대신 줄바꿈으로 둔다: 11개뿐이라 모바일에서도 서너 줄이고, 스크롤이면
 * 뒤쪽 칩이 fog 너머에 숨어 "훑게 한다"는 목적과 어긋난다.
 */
function CategoryChips({ state }: { state: MotifSearchState }) {
  return (
    <Flex gap="x2" wrap="wrap">
      {MOTIF_CATEGORIES.map((category) => (
        <Chip
          key={category}
          size="small"
          selected={state.query === category}
          disabled={state.working}
          onClick={() => state.selectCategory(category)}
        >
          {category}
        </Chip>
      ))}
    </Flex>
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
        disabled={state.working}
        description={`${state.generatePrompt.length}/${MAX_MOTIF_QUERY_LENGTH}`}
        onChange={(event) => state.setGeneratePrompt(event.currentTarget.value)}
      />

      {!state.generated && !state.working ? (
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
      {/* 만들기는 푸터 CTA가 소유한다 — 글자를 고치면 훅이 결과를 비워 CTA가 되돌아온다. */}
      <TextField
        aria-label="넣을 글자"
        placeholder="예: 영선"
        value={state.text}
        maxLength={20}
        disabled={state.working}
        description={`${state.text.length}/20`}
        prefix={<Icon svg={<LanguageIcon />} size={20} />}
        onChange={(event) => state.setText(event.currentTarget.value)}
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
            {photo?.name ?? "사진을 골라 주세요"}
          </Text>
          <Text textStyle="captionSm" color="fg.neutral-subtle">
            {photo ? fileSize(photo.sizeBytes) : "10MB 이하 사진"}
          </Text>
        </VStack>
      </HStack>

      {/* 배경 분리는 테두리와 이어진 평면 배경만 지원한다 — 되는 사진을 먼저 말해 준다.
          실패 문구는 사후 안내라 늦다(풍경·인물로 시도한 뒤에야 알게 된다). */}
      {!photo && !state.working ? (
        <VStack gap="x1" alignItems="stretch">
          <Text textStyle="labelSm">이런 사진이 잘 돼요</Text>
          {PHOTO_TIPS.map((tip) => (
            <Text key={tip} textStyle="captionSm" color="fg.neutral-subtle">
              · {tip}
            </Text>
          ))}
        </VStack>
      ) : null}

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
            description: "예: 작은 벌 · 입력을 멈추면 바로 찾아요.",
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

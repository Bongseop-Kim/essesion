import type { DesignExampleOut } from "@essesion/api-client";
import {
  ActionButton,
  Box,
  ContentPlaceholder,
  Grid,
  Skeleton,
  Text,
  useBreakpoint,
  VStack,
} from "@essesion/shared";
import { useState } from "react";

import {
  svgTileScale,
  svgToDataUri,
} from "@/features/design/model/svg-preview";
import {
  svgColors,
  TemplateShots,
  TemplateSwatches,
  templateLayout,
} from "@/features/design/ui/template-shots";
import { ChipFilterBar } from "@/shared/ui/chip-filter-bar";
import { ContentLayout } from "@/shared/ui/content-layout";

export type TemplatePickerProps = {
  /** 게시된 템플릿 — 로딩 중이면 undefined */
  templates: readonly DesignExampleOut[] | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  /** 행을 누르면 — 세션을 열고 색 선택으로 간다 */
  onSelect: (template: DesignExampleOut) => void;
  /** 세션을 여는 중인 템플릿 id — 그동안 행 전체를 막는다 */
  startingId?: string;
};

const SKELETON_COUNT = 2;

const ALL = "all";

/** 분류 칩 — 템플릿 데이터의 `category` 값(라벨 그대로)을 나온 순서대로. */
function categoryFilters(templates: readonly DesignExampleOut[] | undefined) {
  const categories = new Set<string>();
  for (const template of templates ?? []) {
    if (template.category) categories.add(template.category);
  }
  return [
    { value: ALL, label: "전체" },
    ...[...categories].map((value) => ({ value, label: value })),
  ];
}

/** 디자인 첫 화면 — 매거진처럼 한 줄에 템플릿 하나. 행을 누르면 바로 색 선택으로 간다. */
export function TemplatePicker({
  templates,
  loading,
  failed,
  onRetry,
  onSelect,
  startingId,
}: TemplatePickerProps) {
  const [filter, setFilter] = useState(ALL);
  const visible =
    templates?.filter((t) => filter === ALL || t.category === filter) ?? [];

  return (
    <ContentLayout
      breadcrumbs={[{ label: "홈", href: "/" }, { label: "디자인" }]}
    >
      <VStack gap="x6" alignItems="stretch">
        <VStack gap="x2" alignItems="stretch">
          <Text as="h1" textStyle="title1">
            디자인 템플릿
          </Text>
          <Text textStyle="body" color="fg.neutral-muted">
            마음에 드는 템플릿을 고르면 색을 바꾸고 로고를 넣어 드려요.
          </Text>
        </VStack>
        <ChipFilterBar
          filters={categoryFilters(templates)}
          value={filter}
          onChange={setFilter}
        />
        {loading ? (
          <TemplateListSkeleton />
        ) : failed ? (
          <ContentPlaceholder
            title="템플릿을 불러오지 못했어요"
            description="잠시 뒤 다시 시도해 주세요."
            action={
              <ActionButton
                variant="neutralWeak"
                size="small"
                onClick={onRetry}
              >
                다시 시도
              </ActionButton>
            }
          />
        ) : !templates?.length ? (
          <ContentPlaceholder
            title="준비된 템플릿이 아직 없어요"
            description="템플릿을 준비하고 있어요. 조금만 기다려 주세요."
          />
        ) : visible.length === 0 ? (
          <ContentPlaceholder
            title="이 분류에는 템플릿이 없어요"
            description="다른 분류를 골라 보세요."
          />
        ) : (
          <VStack gap={{ base: "x10", lg: "x12" }} alignItems="stretch">
            {visible.map((template, index) => (
              <TemplateRow
                key={template.id}
                template={template}
                flip={index % 2 === 1}
                starting={startingId === template.id}
                disabled={startingId != null}
                onSelect={() => onSelect(template)}
              />
            ))}
          </VStack>
        )}
      </VStack>
    </ContentLayout>
  );
}

/**
 * 매거진 행 — PC는 3샷 묶음과 글이 좌우로 나뉘고 줄마다 자리를 바꾼다. 모바일은 사진 위, 글 아래.
 * 행 전체가 하나의 버튼이라 사진·제목·설명 어디를 눌러도 이 템플릿으로 시작한다.
 */
function TemplateRow({
  template,
  flip,
  starting,
  disabled,
  onSelect,
}: {
  template: DesignExampleOut;
  flip: boolean;
  starting: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const bp = useBreakpoint();
  const desktop = bp === "lg" || bp === "xl";
  const colors = svgColors(template.preview_svg);

  const shots = (
    <Box width="full" overflow="hidden" borderRadius="r3" bg="bg.neutral-weak">
      <TemplateShots
        shot={{
          imageSrc: svgToDataUri(template.preview_svg),
          alt: template.name,
          tileScale: svgTileScale(template.preview_svg),
          surface: "none",
        }}
        layout={templateLayout(template)}
      />
    </Box>
  );

  const copy = (
    <VStack
      alignItems="start"
      justifyContent="center"
      gap="x4"
      px={{ base: 0, lg: "x8" }}
      height="full"
    >
      <VStack alignItems="start" gap="x2">
        <Text as="span" textStyle={{ base: "title2", lg: "title1" }}>
          {template.name}
        </Text>
        {template.caption ? (
          <Text as="span" textStyle="body" color="fg.neutral-muted">
            {template.caption}
          </Text>
        ) : null}
      </VStack>
      <TemplateSwatches colors={colors} />
    </VStack>
  );

  return (
    <Grid
      as="button"
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-busy={starting || undefined}
      columns={{ base: 1, lg: 2 }}
      gap={{ base: "x4", lg: "x6" }}
      width="full"
      aria-label={`${template.name} 템플릿으로 시작`}
      className="cursor-pointer text-start disabled:cursor-default disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-stroke-focus-ring"
    >
      {desktop && flip ? (
        <>
          {copy}
          {shots}
        </>
      ) : (
        <>
          {shots}
          {copy}
        </>
      )}
    </Grid>
  );
}

function TemplateListSkeleton() {
  return (
    <VStack gap={{ base: "x10", lg: "x12" }} alignItems="stretch" aria-busy>
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
        <Grid
          key={index}
          columns={{ base: 1, lg: 2 }}
          gap={{ base: "x4", lg: "x6" }}
        >
          <Box width="full" style={{ aspectRatio: 1 }}>
            <Skeleton width="full" height="full" radius="r4" />
          </Box>
          <VStack alignItems="stretch" justifyContent="center" gap="x3">
            <Skeleton preset="title" />
            <Skeleton preset="line" />
            <Skeleton preset="line" />
          </VStack>
        </Grid>
      ))}
    </VStack>
  );
}

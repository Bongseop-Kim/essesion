import type { DesignExampleOut } from "@essesion/api-client";
import {
  ActionButton,
  Box,
  ContentPlaceholder,
  Grid,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import { useState } from "react";

import {
  svgTileScale,
  svgToDataUri,
} from "@/features/design/model/svg-preview";
import {
  TemplateTieShot,
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
  /** 카드를 누르면 — 세션을 열고 색 선택으로 간다 */
  onSelect: (template: DesignExampleOut) => void;
  /** 세션을 여는 중인 템플릿 id — 그동안 카드 전체를 막는다 */
  startingId?: string;
};

const SKELETON_COUNT = 8;

/** 한 화면에 여러 템플릿 — 모바일 2열, 태블릿 3열, PC 4열. */
const GRID_COLUMNS = { base: 2, md: 3, lg: 4 } as const;

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

/** 디자인 첫 화면 — 템플릿 카드 그리드. 카드를 누르면 바로 색 선택으로 간다. */
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
          <Grid
            columns={GRID_COLUMNS}
            columnGap={{ base: "x3", lg: "x6" }}
            rowGap={{ base: "x8", lg: "x10" }}
          >
            {visible.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                starting={startingId === template.id}
                disabled={startingId != null}
                onSelect={() => onSelect(template)}
              />
            ))}
          </Grid>
        )}
      </VStack>
    </ContentLayout>
  );
}

/** 카드 — 평면 넥타이 한 장 아래 이름·설명. 카드 전체가 하나의 버튼이라 어디를 눌러도 이 템플릿으로 시작한다. */
function TemplateCard({
  template,
  starting,
  disabled,
  onSelect,
}: {
  template: DesignExampleOut;
  starting: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <VStack
      as="button"
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-busy={starting || undefined}
      aria-label={`${template.name} 템플릿으로 시작`}
      alignItems="stretch"
      gap="x3"
      width="full"
      className="cursor-pointer text-start disabled:cursor-default disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-stroke-focus-ring"
    >
      <TemplateTieShot
        shot={{
          imageSrc: svgToDataUri(template.preview_svg),
          alt: template.name,
          tileScale: svgTileScale(template.preview_svg),
          surface: "none",
        }}
        layout={templateLayout(template)}
      />
      <VStack alignItems="start" gap="x1">
        <Text as="span" textStyle="label" maxLines={1}>
          {template.name}
        </Text>
        {template.caption ? (
          <Text
            as="span"
            textStyle="caption"
            color="fg.neutral-muted"
            maxLines={1}
          >
            {template.caption}
          </Text>
        ) : null}
      </VStack>
    </VStack>
  );
}

function TemplateListSkeleton() {
  return (
    <Grid
      columns={GRID_COLUMNS}
      columnGap={{ base: "x3", lg: "x6" }}
      rowGap={{ base: "x8", lg: "x10" }}
      aria-busy
    >
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
        <VStack key={index} alignItems="stretch" gap="x3">
          <Box width="full" style={{ aspectRatio: "4 / 5" }}>
            <Skeleton width="full" height="full" radius="r4" />
          </Box>
          <Skeleton preset="line" />
          <Skeleton preset="line" />
        </VStack>
      ))}
    </Grid>
  );
}

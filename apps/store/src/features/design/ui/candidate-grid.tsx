import {
  Box,
  Callout,
  ContentPlaceholder,
  Flex,
  Float,
  Grid,
  Icon,
  ImageFrame,
  MenuContent,
  MenuRoot,
  MenuTrigger,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import {
  CheckIcon,
  InformationCircleIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import {
  type ComponentPropsWithRef,
  Fragment,
  type MouseEvent,
  type ReactNode,
} from "react";

export type DesignCandidate = {
  id: string;
  /** Sanitized SVG encoded as a data URI. */
  imageSrc: string;
  alt?: string;
};

export type CandidateGridProps = {
  candidates: readonly DesignCandidate[];
  selectedId?: string | null;
  warnings?: readonly string[];
  loading?: boolean;
  disabled?: boolean;
  onSelect: (
    candidate: DesignCandidate,
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
  /** 있으면 각 타일을 메뉴 트리거로 감싸 탭 시 앵커 메뉴로 항목을 노출한다.
      모바일 전용 분기는 호출부가 소유(prop 유무로 판단). */
  menu?: ReactNode;
};

export function CandidateGrid({
  candidates,
  selectedId,
  warnings = [],
  loading = false,
  disabled = false,
  onSelect,
  menu,
}: CandidateGridProps) {
  if (loading) return <CandidateGridSkeleton />;

  return (
    <VStack gap="x3" alignItems="stretch">
      {warnings.length > 0 ? (
        <Callout
          tone="neutral"
          icon={<Icon svg={<InformationCircleIcon />} size={16} />}
          title="생성 결과 안내"
          description={warnings.join(" · ")}
        />
      ) : null}

      {candidates.length > 0 ? (
        <Grid columns={{ base: 2, md: 4 }} gap="x3" aria-label="디자인 후보">
          {candidates.map((candidate, index) => {
            const label = `디자인 후보 ${index + 1}`;
            const tile = (
              <CandidateTile
                label={label}
                imageSrc={candidate.imageSrc}
                alt={candidate.alt ?? `AI 디자인 후보 ${index + 1}`}
                selected={candidate.id === selectedId}
                disabled={disabled}
                onClick={(event) => onSelect(candidate, event)}
              />
            );
            return menu ? (
              <MenuRoot key={candidate.id}>
                <MenuTrigger>{tile}</MenuTrigger>
                <MenuContent aria-label={`${label} 액션`}>{menu}</MenuContent>
              </MenuRoot>
            ) : (
              <Fragment key={candidate.id}>{tile}</Fragment>
            );
          })}
        </Grid>
      ) : (
        <ContentPlaceholder
          icon={<Icon svg={<SparklesIcon />} size={32} />}
          title="아직 생성된 후보가 없어요"
          description="원하는 패턴을 설명하면 후보를 여기에 보여 드릴게요."
        />
      )}
    </VStack>
  );
}

export type CandidateTileProps = Omit<
  ComponentPropsWithRef<"button">,
  "onClick" | "aria-label" | "aria-pressed" | "children"
> & {
  label: string;
  imageSrc?: string;
  alt: string;
  selected?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
};

export function CandidateTile({
  label,
  imageSrc,
  alt,
  selected = false,
  disabled = false,
  onClick,
  ...rest
}: CandidateTileProps) {
  return (
    <Box
      {...rest}
      as="button"
      type="button"
      aria-label={label}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      borderWidth={2}
      borderColor={selected ? "stroke.brand" : "stroke.neutral-weak"}
      borderRadius="r3"
      bg={selected ? "bg.brand-weak" : "bg.layer-default"}
      p="x1"
      className="text-left transition-colors duration-100 ease-standard hover:border-stroke-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring disabled:pointer-events-none disabled:opacity-50"
    >
      <ImageFrame
        ratio={1}
        src={imageSrc}
        alt={alt}
        fit="cover"
        borderRadius="r2"
      >
        {selected ? (
          <Float placement="top-end" offsetX="x2" offsetY="x2">
            {/* 선택 체크는 PC 프리뷰 패널과의 연동 표시 — 모바일(탭=메뉴)에선 숨긴다. */}
            <Flex
              display={{ base: "none", lg: "flex" }}
              align="center"
              justify="center"
              width={28}
              height={28}
              borderRadius="full"
              bg="bg.brand-solid"
              className="text-fg-contrast"
            >
              <Icon svg={<CheckIcon />} size={18} />
            </Flex>
          </Float>
        ) : null}
      </ImageFrame>
    </Box>
  );
}

export function CandidateGridSkeleton() {
  return (
    <VStack
      gap="x3"
      alignItems="stretch"
      aria-busy="true"
      aria-label="디자인 후보 생성 중"
    >
      <Text textStyle="bodySm" color="fg.neutral-muted">
        디자인을 생성하고 있어요. 수십 초 정도 걸릴 수 있어요.
      </Text>
      <Grid columns={{ base: 2, md: 4 }} gap="x3">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton
            key={index}
            width="100%"
            radius="r4"
            style={{ aspectRatio: 1 }}
          />
        ))}
      </Grid>
    </VStack>
  );
}

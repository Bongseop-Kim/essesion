import {
  AspectRatio,
  Box,
  Grid,
  HStack,
  ImageFrame,
  Text,
  VStack,
} from "@essesion/shared";
import { useReducedMotion } from "motion/react";

const HEIGHT_GUIDE = [
  { height: "150cm", length: "41cm" },
  { height: "155cm", length: "43cm" },
  { height: "160cm", length: "45cm" },
  { height: "165cm", length: "47cm" },
  { height: "170cm", length: "49cm" },
  { height: "175cm", length: "51cm" },
  { height: "180cm", length: "53cm" },
  { height: "185cm", length: "55cm" },
  { height: "190cm", length: "57cm" },
] as const;

const REFORM_STEPS = [
  {
    title: "사진 업로드",
    description:
      "넥타이 사진을 등록해 항목을 구분합니다. 여러 개도 각각의 사진으로 쉽게 확인할 수 있습니다.",
  },
  {
    title: "수선 옵션 입력",
    description:
      "자동·폭·복원 수선을 고르고, 자동 수선 방식과 착용자 키 또는 희망 폭을 입력합니다.",
  },
  {
    title: "일괄 적용 후 접수",
    description:
      "같은 요청은 선택 항목에 한 번에 적용하고 장바구니 또는 바로주문으로 접수합니다.",
  },
] as const;

const DIMPLE_COMPARISON = [
  {
    label: "Basic",
    title: "기본",
    description: "매끈하고 단정한 매듭 느낌",
    image: "/images/reform/normal.webp",
  },
  {
    label: "Dimple",
    title: "딤플",
    description: "중앙 홈이 살아 있는 입체적인 매듭 느낌",
    image: "/images/reform/dimple.webp",
  },
] as const;

const WIDTH_COMPARISON = [
  {
    label: "Before",
    title: "수선 전",
    description: "익숙하지만 다소 무겁게 보일 수 있는 기존 폭",
    image: "/images/reform/wide.webp",
  },
  {
    label: "After",
    title: "폭 수선 후",
    description: "같은 넥타이를 원하는 폭으로 다듬은 슬림한 인상",
    image: "/images/reform/slim.webp",
  },
] as const;

/**
 * 키→권장 길이 참조표.
 * 기본: 상세 가이드용 카드형 테이블. compact: 사이드바 요약 카드용 —
 * SummaryCard.Row와 같은 조용한 2열 리스트(보더·헤더 배경 없음).
 */
export function ReformHeightGuide({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <VStack gap="x2" alignItems="stretch">
        <HStack justify="space-between" gap="x4">
          <Text textStyle="captionSm" color="fg.neutral-subtle">
            착용자 키
          </Text>
          <Text textStyle="captionSm" color="fg.neutral-subtle">
            권장 길이
          </Text>
        </HStack>
        {HEIGHT_GUIDE.map((guide) => (
          <HStack key={guide.height} justify="space-between" gap="x4">
            <Text textStyle="bodySm" color="fg.neutral-muted">
              {guide.height}
            </Text>
            <Text textStyle="labelSm">{guide.length}</Text>
          </HStack>
        ))}
      </VStack>
    );
  }
  return (
    <Box
      overflow="hidden"
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="r3"
    >
      <Grid templateColumns="1fr 1fr" bg="bg.neutral-weak">
        <Text as="div" textStyle="labelSm" px="x4" py="x3">
          착용자 키
        </Text>
        <Text as="div" textStyle="labelSm" px="x4" py="x3" align="end">
          권장 넥타이 길이
        </Text>
      </Grid>
      {HEIGHT_GUIDE.map((guide) => (
        <Grid
          key={guide.height}
          templateColumns="1fr 1fr"
          className="border-t border-stroke-neutral-weak"
        >
          <Text as="div" textStyle="bodySm" px="x4" py="x3">
            {guide.height}
          </Text>
          <Text
            as="div"
            textStyle="bodySm"
            color="fg.neutral-muted"
            px="x4"
            py="x3"
            align="end"
          >
            {guide.length}
          </Text>
        </Grid>
      ))}
    </Box>
  );
}

export function ReformServiceGuide() {
  return (
    <VStack gap="x10" alignItems="stretch">
      <ReformVideo
        src="/images/reform/reform.mp4"
        ratio={4 / 3}
        label="넥타이 수선 서비스 소개 영상"
      />

      <SectionHeading
        eyebrow="Reform Service"
        title="수동 넥타이를 자동 넥타이로 바꾸거나 원하는 폭으로 수선해 보세요"
        description="사진 한 장으로 접수할 수 있고, 여러 개도 일괄 적용으로 빠르게 요청할 수 있습니다. 형태 복원이 필요한 넥타이도 함께 상담할 수 있습니다."
      />

      <VStack gap="x4" alignItems="stretch">
        <SectionHeading
          eyebrow="How It Works"
          title="진행 방법"
          description="복잡한 과정 없이 세 단계로 접수할 수 있습니다."
          align="start"
        />
        <Grid columns={{ base: 1, md: 3 }} gap="x3">
          {REFORM_STEPS.map((step, index) => (
            <Box
              key={step.title}
              borderWidth={1}
              borderColor="stroke.neutral-weak"
              borderRadius="r3"
              bg="bg.layer-default"
              p="x4"
            >
              <VStack gap="x3" alignItems="stretch">
                <Box
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  width={32}
                  height={32}
                  borderRadius="full"
                  bg="bg.brand-solid"
                >
                  <Text textStyle="labelSm" color="fg.contrast">
                    {index + 1}
                  </Text>
                </Box>
                <Text as="h3" textStyle="title3">
                  {step.title}
                </Text>
                <Text textStyle="bodySm" color="fg.neutral-muted">
                  {step.description}
                </Text>
              </VStack>
            </Box>
          ))}
        </Grid>
      </VStack>

      <VStack gap="x4" alignItems="stretch">
        <SectionHeading
          eyebrow="Length Guide"
          title="내게 맞는 넥타이 길이"
          description="착용자의 키를 기준으로 자동 수선 후 권장 길이를 확인해 주세요. 체형과 매는 위치에 따라 실제 완성 길이는 상담 후 조정될 수 있습니다."
          align="start"
        />
        <ReformHeightGuide />
      </VStack>

      <Grid columns={{ base: 1, md: 2 }} gap="x6" alignItems="center">
        <ReformVideo
          src="/images/reform/reform-vertical.mp4"
          ratio={3 / 4}
          label="자동 넥타이 착용 예시 영상"
        />
        <VStack gap="x4" alignItems="stretch">
          <SectionHeading
            eyebrow="Automatic Reform"
            title="자동 넥타이로 바꿔보세요"
            description="매번 매듭을 만들지 않아도 빠르고 간편하게 착용할 수 있습니다."
            align="start"
          />
          <OptionNote
            title="지퍼 방식"
            description="딤플과 돌려묶기를 각각 추가할 수 있습니다."
          />
          <OptionNote
            title="끈 방식"
            description="딤플을 추가할 수 있으며 돌려묶기는 제공하지 않습니다."
          />
        </VStack>
      </Grid>

      <ComparisonSection
        eyebrow="Basic / Dimple"
        title="기본과 딤플, 원하는 매듭 인상으로 선택해 보세요"
        description="깔끔한 기본 스타일과 중앙 홈이 살아 있는 딤플 스타일을 사진으로 비교해 보세요."
        items={DIMPLE_COMPARISON}
      />

      <ComparisonSection
        eyebrow="Width Reform"
        title="몇 밀리미터 차이가 인상을 바꿉니다"
        description="현재보다 좁은 희망 폭을 입력해 주세요. 작은 폭 차이도 실루엣과 전체 인상을 다르게 만듭니다."
        items={WIDTH_COMPARISON}
      />

      <Box
        borderWidth={1}
        borderColor="stroke.neutral-weak"
        borderRadius="r3"
        bg="bg.neutral-weak"
        p={{ base: "x5", md: "x6" }}
      >
        <SectionHeading
          eyebrow="Restoration Reform"
          title="형태와 마감을 복원하고 싶다면"
          description="복원 수선은 손상 상태와 원단에 따라 가능한 작업이 달라집니다. 사진으로 먼저 접수하고 필요한 내용만 짧게 남겨 주세요. 메모가 없어도 상담 후 작업 범위와 진행 가능 여부를 안내합니다."
          align="start"
        />
      </Box>
    </VStack>
  );
}

function ReformVideo({
  src,
  ratio,
  label,
}: {
  src: string;
  ratio: number;
  label: string;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <AspectRatio ratio={ratio} className="rounded-r3 bg-bg-neutral-weak">
      <video
        src={src}
        aria-label={label}
        autoPlay={!reducedMotion}
        loop={!reducedMotion}
        muted
        playsInline
        controls
        preload="metadata"
        className="absolute inset-0 size-full object-cover"
      />
    </AspectRatio>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  description: string;
  align?: "start" | "center";
}) {
  return (
    <VStack gap="x2" alignItems={align === "center" ? "center" : "stretch"}>
      <Text textStyle="captionSm" color="fg.neutral-subtle" align={align}>
        {eyebrow}
      </Text>
      <Text as="h2" textStyle="title2" align={align}>
        {title}
      </Text>
      <Text textStyle="body" color="fg.neutral-muted" align={align}>
        {description}
      </Text>
    </VStack>
  );
}

function OptionNote({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Box
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="r3"
      p="x4"
    >
      <VStack gap="x1" alignItems="stretch">
        <Text as="h3" textStyle="label">
          {title}
        </Text>
        <Text textStyle="bodySm" color="fg.neutral-muted">
          {description}
        </Text>
      </VStack>
    </Box>
  );
}

function ComparisonSection({
  eyebrow,
  title,
  description,
  items,
}: {
  eyebrow: string;
  title: string;
  description: string;
  items: ReadonlyArray<{
    label: string;
    title: string;
    description: string;
    image: string;
  }>;
}) {
  return (
    <VStack gap="x5" alignItems="stretch">
      <SectionHeading
        eyebrow={eyebrow}
        title={title}
        description={description}
      />
      <Grid columns={{ base: 1, md: 2 }} gap="x4">
        {items.map((item) => (
          <VStack key={item.label} gap="x3" alignItems="stretch">
            <ImageFrame
              ratio={1}
              src={item.image}
              alt={item.title}
              borderRadius="r3"
              fit="cover"
              stroke
            />
            <VStack gap="x1">
              <Text
                textStyle="captionSm"
                color="fg.neutral-subtle"
                align="center"
              >
                {item.label}
              </Text>
              <Text as="h3" textStyle="title3" align="center">
                {item.title}
              </Text>
              <Text textStyle="bodySm" color="fg.neutral-muted" align="center">
                {item.description}
              </Text>
            </VStack>
          </VStack>
        ))}
      </Grid>
    </VStack>
  );
}

import {
  AspectRatio,
  Box,
  cn,
  Flex,
  Grid,
  HStack,
  ImageFrame,
  Text,
  VStack,
} from "@essesion/shared";

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

const MECHANISM_COMPARISON = [
  {
    label: "Zipper",
    title: "지퍼 방식",
    description:
      "슬라이더를 위로 올린 상태에서 길이를 조절하고, 아래로 내리면 고정됩니다.",
    image: "/images/reform/zipper.webp",
  },
  {
    label: "String",
    title: "끈 방식",
    description:
      "원터치 버튼을 누른 상태에서 길이를 조절하고, 손을 떼면 고정됩니다.",
    image: "/images/reform/string.webp",
  },
] as const;

const KNOT_COMPARISON = [
  {
    label: "Back · Basic",
    title: "기본 방식 뒷면",
    description: "좌우가 대칭인 형태로 단정하게 고정됩니다.",
    image: "/images/reform/zipper.webp",
  },
  {
    label: "Back · Turn Knot",
    title: "돌려묶기 뒷면",
    description:
      "원단을 돌려 묶어 제작자가 매듭의 균형과 방향을 조절할 수 있습니다.",
    image: "/images/reform/knot.webp",
  },
  {
    label: "Front · Basic",
    title: "기본 방식 앞면",
    description: "좌우가 고르게 정돈된 매듭 인상입니다.",
    image: "/images/reform/zipper-front.webp",
  },
  {
    label: "Front · Turn Knot",
    title: "돌려묶기 앞면",
    description:
      "자세히 보면 자연스러운 비대칭과 손으로 묶은 듯한 인상이 드러납니다.",
    image: "/images/reform/knot-front.webp",
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

// 실사 넥타이 컷(tie-mask.png·tie-shadow.webp, 794×2097) 기준 좌표. 오른쪽에 치수선 칸을 덧붙여
// 한 viewBox로 그린다 — top·bottom은 매듭 위 끝·대검 끝, left는 실루엣 왼쪽 끝, knotRight·tipX는 보조선이
// 출발하는 가장자리.
const TIE_ART = {
  width: 794,
  height: 2097,
  left: 240,
  top: 37,
  bottom: 2075,
  knotRight: 520,
  tipX: 420,
} as const;
const TIE_FIGURE_WIDTH = 900;
const TIE_RULER_X = 850;

const TIE_LAYER_STYLE = {
  maskImage: "url(/images/tie-mask.png)",
  maskSize: "100% 100%",
  maskRepeat: "no-repeat",
} as const;

/** "매듭 포함" 라벨 캡슐 — 치수선 가운데에 얹는다. */
function KnotLabel() {
  return (
    <Box
      bg="bg.layer-default"
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="full"
      px="x2"
      py="x0_5"
    >
      <Text
        textStyle="captionSm"
        color="fg.neutral"
        className="whitespace-nowrap"
      >
        매듭 포함
      </Text>
    </Box>
  );
}

/**
 * 세로로 선 넥타이 그림 — 오른쪽에 매듭 위 끝~대검 끝 치수선과 보조선. `label`이 거짓이면 라벨을
 * 빼고 그린다(눕혀 쓰는 모바일 — 라벨까지 돌리면 글자가 누우니 바깥에서 얹는다).
 */
function TieDrawing({ label = true }: { label?: boolean }) {
  const width = TIE_FIGURE_WIDTH;
  return (
    <Box
      position="relative"
      width="full"
      style={{ aspectRatio: `${width} / ${TIE_ART.height}` }}
    >
      <Box
        position="absolute"
        top={0}
        bottom={0}
        left={0}
        style={{ width: `${(TIE_ART.width / width) * 100}%` }}
      >
        <Box
          position="absolute"
          inset={0}
          bg="bg.brand-solid"
          style={TIE_LAYER_STYLE}
        />
        {/* 명암도 실루엣 안에만 — 셔츠 깃까지 그리면 패널 위에서 탁해 보인다 */}
        <Box
          position="absolute"
          inset={0}
          style={{
            ...TIE_LAYER_STYLE,
            backgroundImage: "url(/images/tie-shadow.webp)",
            backgroundSize: "100% 100%",
          }}
        />
      </Box>
      <svg
        viewBox={`0 0 ${width} ${TIE_ART.height}`}
        className="absolute inset-0 size-full overflow-visible text-fg-neutral-muted"
        aria-hidden="true"
      >
        <g stroke="currentColor" fill="none">
          {/* 보조선 — 매듭 위 끝·대검 끝에서 치수선까지 */}
          <g strokeDasharray="2 3" opacity={0.6}>
            <line
              x1={TIE_ART.knotRight}
              x2={TIE_RULER_X + 30}
              y1={TIE_ART.top}
              y2={TIE_ART.top}
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={TIE_ART.tipX}
              x2={TIE_RULER_X + 30}
              y1={TIE_ART.bottom}
              y2={TIE_ART.bottom}
              vectorEffect="non-scaling-stroke"
            />
          </g>
          <line
            x1={TIE_RULER_X}
            x2={TIE_RULER_X}
            y1={TIE_ART.top}
            y2={TIE_ART.bottom}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </svg>
      {label ? (
        <Box
          position="absolute"
          top="50%"
          style={{
            left: `${(TIE_RULER_X / width) * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        >
          <KnotLabel />
        </Box>
      ) : null}
    </Box>
  );
}

/** 모바일: 데스크톱 그림을 -90° 눕힌다 — 매듭이 왼쪽, 치수선이 위. 라벨만 눕히지 않고 치수선 위에 얹는다. */
function LyingTie() {
  // 눕히면 그림의 x가 아래→위가 된다. 넥타이 왼쪽 가장자리(TIE_ART.left) 밖은 비어 있어 그만큼
  // 아래를 잘라 바깥 높이를 잡는다 — 회전 상자는 위쪽(치수선)에 붙인다.
  const lyingHeight = TIE_FIGURE_WIDTH - TIE_ART.left;
  return (
    <Box
      position="relative"
      width="full"
      style={{ aspectRatio: `${TIE_ART.height} / ${lyingHeight}` }}
    >
      {/* 회전 전 상자의 폭 = 눕힌 뒤 높이 — 그 중심을 바깥 위에서 폭의 절반만큼 내려 돌린다 */}
      <Box
        position="absolute"
        left="50%"
        style={{
          top: `${(TIE_FIGURE_WIDTH / 2 / lyingHeight) * 100}%`,
          width: `${(TIE_FIGURE_WIDTH / TIE_ART.height) * 100}%`,
          transform: "translate(-50%, -50%) rotate(-90deg)",
        }}
      >
        <TieDrawing label={false} />
      </Box>
      {/* 눕히면 치수선 x가 위에서부터의 거리가 되고, 치수선 가운데 y가 왼쪽에서부터의 거리가 된다 */}
      <Box
        position="absolute"
        style={{
          top: `${((TIE_FIGURE_WIDTH - TIE_RULER_X) / lyingHeight) * 100}%`,
          left: `${((TIE_ART.top + TIE_ART.bottom) / 2 / TIE_ART.height) * 100}%`,
          transform: "translate(-50%, -50%)",
        }}
      >
        <KnotLabel />
      </Box>
    </Box>
  );
}

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
            권장 길이(매듭 포함)
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
    // 데스크톱: 재는 법 | 착용자 키 | 권장 길이 1:1:1, 그림 칸이 본문 행 전체를 세로로 차지한다.
    // 모바일: 눕힌 넥타이를 카드 맨 위에 두고 아래는 2열 표.
    <Box
      overflow="hidden"
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="r3"
    >
      <Box
        display={{ base: "block", md: "none" }}
        px="x6"
        py="x5"
        className="border-b border-stroke-neutral-weak"
        aria-hidden="true"
      >
        <LyingTie />
      </Box>
      <Grid columns={{ base: 2, md: 3 }} bg="bg.neutral-weak">
        <Text
          as="div"
          display={{ base: "none", md: "block" }}
          textStyle="labelSm"
          px="x4"
          py="x3"
        >
          재는 법
        </Text>
        <Text as="div" textStyle="labelSm" px="x4" py="x3">
          착용자 키
        </Text>
        <Text as="div" textStyle="labelSm" px="x4" py="x3">
          권장 넥타이 길이
        </Text>
      </Grid>
      <Grid
        columns={{ base: 1, md: 3 }}
        className="border-t border-stroke-neutral-weak"
      >
        <Flex
          display={{ base: "none", md: "flex" }}
          justify="center"
          align="center"
          px="x6"
          py="x5"
          className="border-r border-stroke-neutral-weak"
          aria-hidden="true"
        >
          <Box width={120}>
            <TieDrawing />
          </Box>
        </Flex>
        <Box className="md:col-span-2">
          {HEIGHT_GUIDE.map((guide, index) => (
            <Grid
              key={guide.height}
              templateColumns="1fr 1fr"
              className={
                index === 0 ? undefined : "border-t border-stroke-neutral-weak"
              }
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
              >
                {guide.length}
              </Text>
            </Grid>
          ))}
        </Box>
      </Grid>
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
            description="돌려묶기를 추가할 수 있으며 딤플은 제공하지 않습니다."
          />
        </VStack>
      </Grid>

      <ComparisonSection
        eyebrow="Zipper / String"
        title="길이를 조절하는 방식이 다릅니다"
        description="지퍼와 끈 모두 원하는 길이로 간편하게 조절한 뒤 고정할 수 있습니다."
        items={MECHANISM_COMPARISON}
      />

      <ComparisonSection
        eyebrow="Basic / Turn Knot"
        title="기본 방식과 돌려묶기를 비교해 보세요"
        description="앞면의 큰 차이는 없지만, 돌려묶기는 제작 단계에서 자연스러운 비대칭과 손매듭 같은 인상을 더할 수 있습니다."
        items={KNOT_COMPARISON}
      />

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
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  return (
    <AspectRatio ratio={ratio} className="rounded-r3 bg-bg-neutral-weak">
      <video
        src={src}
        aria-label={label}
        autoPlay={!reducedMotion}
        loop={!reducedMotion}
        muted
        playsInline
        controls={reducedMotion}
        preload="metadata"
        className={cn(
          "absolute inset-0 size-full object-cover",
          !reducedMotion && "pointer-events-none",
        )}
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

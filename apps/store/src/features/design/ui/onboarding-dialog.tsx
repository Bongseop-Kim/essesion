import {
  ActionButton,
  Box,
  HStack,
  Icon,
  ResponsiveModal,
  Text,
  VStack,
} from "@essesion/shared";
import {
  CheckIcon,
  Squares2X2Icon,
  SwatchIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";

const ONBOARDING_PAGES = [
  {
    title: "날염으로 선명한 패턴을 표현해요",
    description:
      "완성된 원단 위에 디자인을 인쇄하는 방식이에요. 섬세한 선과 다양한 색을 또렷하게 살릴 수 있어요.",
    points: [
      "그래픽과 작은 디테일에 적합",
      "다양한 색상 표현",
      "빠른 디자인 확인",
    ],
    icon: SwatchIcon,
  },
  {
    title: "선염으로 직조의 깊이를 더해요",
    description:
      "실을 먼저 염색한 뒤 무늬를 직조하는 방식이에요. 짜임에 따라 클래식하고 입체적인 질감이 살아나요.",
    points: [
      "넥타이다운 깊은 질감",
      "짜임에 따른 분위기 변화",
      "원단 시뮬레이션 지원",
    ],
    icon: Squares2X2Icon,
  },
] as const;

export type OnboardingDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
};

export function OnboardingDialog({
  open,
  onOpenChange,
  onComplete,
}: OnboardingDialogProps) {
  const [page, setPage] = useState(0);
  const content = ONBOARDING_PAGES[page] ?? ONBOARDING_PAGES[0];
  const lastPage = page === ONBOARDING_PAGES.length - 1;
  const PageIcon = content.icon;

  useEffect(() => {
    if (!open) setPage(0);
  }, [open]);

  const finish = () => {
    onComplete();
    onOpenChange(false);
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="AI 디자인 시작하기"
      description={`${page + 1} / ${ONBOARDING_PAGES.length}`}
      size="small"
      showCloseButton
      footer={
        <HStack gap="x2">
          {page > 0 ? (
            <Box
              as={ActionButton}
              type="button"
              variant="neutralOutline"
              width="full"
              onClick={() => setPage((current) => current - 1)}
            >
              이전
            </Box>
          ) : null}
          <Box
            as={ActionButton}
            type="button"
            width="full"
            onClick={lastPage ? finish : () => setPage(1)}
          >
            {lastPage ? "디자인 시작하기" : "다음"}
          </Box>
        </HStack>
      }
    >
      <VStack gap="x5" alignItems="stretch">
        <VStack
          gap="x3"
          align="center"
          borderRadius="r4"
          bg="bg.brand-weak"
          px="x5"
          py="x8"
        >
          <Icon svg={<PageIcon />} size={48} color="fg.brand" />
          <Text as="h3" textStyle="title3" align="center">
            {content.title}
          </Text>
          <Text textStyle="bodySm" color="fg.neutral-muted" align="center">
            {content.description}
          </Text>
        </VStack>

        <VStack as="ul" gap="x3" alignItems="stretch">
          {content.points.map((point) => (
            <HStack as="li" key={point} gap="x2" align="flex-start">
              <Icon svg={<CheckIcon />} size={18} color="fg.brand" />
              <Text textStyle="bodySm">{point}</Text>
            </HStack>
          ))}
        </VStack>

        <HStack justify="center" gap="x1_5" aria-label="온보딩 진행 상태">
          {ONBOARDING_PAGES.map((item, index) => (
            <Box
              key={item.title}
              width={index === page ? "x5" : "x2"}
              height="x2"
              borderRadius="full"
              bg={index === page ? "bg.brand-solid" : "bg.neutral-weak"}
              aria-current={index === page ? "step" : undefined}
            />
          ))}
        </HStack>
      </VStack>
    </ResponsiveModal>
  );
}

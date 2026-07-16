import { Box, Callout, Grid, Text, VStack } from "@essesion/shared";

const STEPS = [
  ["옵션 선택", "수량·원단·봉제·사양·마감과 참고 자료를 선택합니다."],
  ["결제 또는 견적", "4~99개는 바로 결제하고, 100개 이상은 견적을 요청합니다."],
  [
    "제작",
    "사양 확인 후 제작을 시작하며 진행 상황은 주문 내역에서 확인합니다.",
  ],
  ["발송", "제작이 끝나면 송장과 함께 완성품을 발송합니다."],
] as const;

export function CustomOrderServiceGuide() {
  return (
    <VStack gap="x8" alignItems="stretch">
      <VStack gap="x2" alignItems="stretch">
        <Text textStyle="captionSm" color="fg.neutral-subtle">
          Custom Order
        </Text>
        <Text as="h2" textStyle="title2">
          원하는 사양으로 제작하는 맞춤 넥타이
        </Text>
        <Text textStyle="body" color="fg.neutral-muted">
          소량 주문부터 대량 견적까지 같은 주문서에서 준비할 수 있습니다. 예상
          제작 기간은 선택한 사양과 수량에 따라 안내합니다.
        </Text>
      </VStack>

      <Grid columns={{ base: 1, md: 4 }} gap="x3">
        {STEPS.map(([title, description], index) => (
          <Box
            key={title}
            borderWidth={1}
            borderColor="stroke.neutral-weak"
            borderRadius="r3"
            p="x4"
          >
            <VStack gap="x2" alignItems="stretch">
              <Text textStyle="captionSm" color="fg.neutral-subtle">
                {index + 1}
              </Text>
              <Text as="h3" textStyle="title3">
                {title}
              </Text>
              <Text textStyle="bodySm" color="fg.neutral-muted">
                {description}
              </Text>
            </VStack>
          </Box>
        ))}
      </Grid>

      <Grid columns={{ base: 1, md: 2 }} gap="x4">
        <Box
          borderWidth={1}
          borderColor="stroke.neutral-weak"
          borderRadius="r3"
          p="x5"
        >
          <VStack gap="x2" alignItems="stretch">
            <Text as="h3" textStyle="title3">
              4~99개 · 바로 주문
            </Text>
            <Text textStyle="bodySm" color="fg.neutral-muted">
              서버가 계산한 금액을 확인하고 배송지와 쿠폰을 선택한 뒤 바로
              결제합니다.
            </Text>
          </VStack>
        </Box>
        <Box
          borderWidth={1}
          borderColor="stroke.neutral-weak"
          borderRadius="r3"
          p="x5"
        >
          <VStack gap="x2" alignItems="stretch">
            <Text as="h3" textStyle="title3">
              100개 이상 · 견적 협의
            </Text>
            <Text textStyle="bodySm" color="fg.neutral-muted">
              요청 → 견적발송 → 협의중 → 확정 순서로 진행하며 담당자가
              알림톡으로 안내합니다.
            </Text>
          </VStack>
        </Box>
      </Grid>

      <Callout
        tone="informative"
        title="AI 디자인을 주문에 활용할 수 있어요"
        description="디자인 도구에서 완성한 패턴을 참고 자료로 연결해 제작 의도를 더 정확히 전달해 보세요. 맞춤 제작은 접수 후 원부자재와 공정이 배정되므로 취소·환불이 제한될 수 있습니다."
      />
    </VStack>
  );
}

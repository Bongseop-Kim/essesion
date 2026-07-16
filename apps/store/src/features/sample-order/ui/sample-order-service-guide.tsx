import { Box, Callout, Grid, Text, VStack } from "@essesion/shared";

const SAMPLE_TYPES = [
  ["원단 샘플", "선택한 원단과 디자인 표현을 먼저 확인합니다."],
  ["봉제 샘플", "타이 방식과 심지 등 완성품의 봉제 사양을 확인합니다."],
  ["원단 + 봉제", "원단 표현과 완성품 형태를 한 번에 검토합니다."],
] as const;

const STEPS = [
  ["구성 선택", "샘플 유형과 원단·봉제 사양을 선택합니다."],
  ["결제", "서버 계산 금액과 배송지를 확인한 뒤 결제합니다."],
  ["제작", "선택한 구성으로 샘플을 제작합니다. 예상 기간은 28~42일입니다."],
  [
    "확인 후 본주문",
    "샘플을 검토하고 발급된 할인 쿠폰으로 본주문을 준비합니다.",
  ],
] as const;

export function SampleOrderServiceGuide() {
  return (
    <VStack gap="x8" alignItems="stretch">
      <VStack gap="x2" alignItems="stretch">
        <Text textStyle="captionSm" color="fg.neutral-subtle">
          Sample Order
        </Text>
        <Text as="h2" textStyle="title2">
          본제작 전에 원단과 봉제 품질을 확인하세요
        </Text>
        <Text textStyle="body" color="fg.neutral-muted">
          필요한 범위만 선택해 샘플을 제작하고, 결과를 확인한 뒤 본주문으로
          이어갈 수 있습니다.
        </Text>
      </VStack>

      <Grid columns={{ base: 1, md: 3 }} gap="x3">
        {SAMPLE_TYPES.map(([title, description]) => (
          <Box
            key={title}
            borderWidth={1}
            borderColor="stroke.neutral-weak"
            borderRadius="r3"
            p="x4"
          >
            <VStack gap="x2" alignItems="stretch">
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

      <Callout
        tone="informative"
        title="샘플 결제 후 본주문 할인 쿠폰을 드려요"
        description="샘플 결과를 확인한 뒤 주문 제작 결제에서 쿠폰을 적용할 수 있습니다. 샘플은 선택 사양에 맞춰 개별 제작되므로 제작 접수 후 취소·환불이 제한됩니다."
      />
    </VStack>
  );
}

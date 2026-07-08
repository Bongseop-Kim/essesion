// 5단계에서 재작성 — 디자인 시스템 살아있는 토큰 시트 (검증용 임시 화면)

import {
  Box,
  Button,
  bgRoles,
  Flex,
  Float,
  fgRoles,
  Grid,
  HStack,
  Icon,
  radiusSteps,
  shadowSteps,
  spacingSteps,
  strokeRoles,
  Text,
  type TextStyleName,
  useBreakpoint,
  VStack,
} from "@essesion/shared";
import { ShoppingBagIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";

const textStyleNames: TextStyleName[] = [
  "display1",
  "title1",
  "title2",
  "title3",
  "body",
  "bodySm",
  "label",
  "labelSm",
  "caption",
  "captionSm",
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <VStack as="section" gap="x4">
      <Text as="h2" textStyle="title2">
        {title}
      </Text>
      {children}
    </VStack>
  );
}

function Swatch({ token }: { token: string }) {
  return (
    <HStack gap="x3">
      <Box
        width={40}
        height={24}
        bg={token}
        borderColor="stroke.neutral-weak"
        borderRadius="r1"
        borderWidth={1}
      />
      <Text textStyle="captionSm" color="fg.neutral-muted">
        {token}
      </Text>
    </HStack>
  );
}

export function Preview() {
  const bp = useBreakpoint();
  return (
    <Box maxWidth={1040} mx="auto" px={{ base: "x4", md: "x6" }} py="x8">
      <VStack gap="x12">
        <VStack gap="x2">
          <Text as="h1" textStyle="display1">
            essesion 디자인 시스템
          </Text>
          <Text textStyle="bodySm" color="fg.neutral-muted">
            현재 브레이크포인트: {bp} — 창 크기를 바꿔 반응형을 확인
          </Text>
        </VStack>

        <Section title="시맨틱 컬러">
          <Grid columns={{ base: 2, md: 3, lg: 4 }} gap="x3">
            {fgRoles.map((r) => (
              <Swatch key={r} token={`fg.${r}`} />
            ))}
            {bgRoles.map((r) => (
              <Swatch key={r} token={`bg.${r}`} />
            ))}
            {strokeRoles.map((r) => (
              <Swatch key={r} token={`stroke.${r}`} />
            ))}
          </Grid>
        </Section>

        <Section title="타이포그래피">
          <VStack gap="x3">
            {textStyleNames.map((name) => (
              <HStack key={name} gap="x4">
                <Box width={88}>
                  <Text textStyle="captionSm" color="fg.neutral-subtle">
                    {name}
                  </Text>
                </Box>
                <Text textStyle={name}>상품을 담고 주문해 보세요</Text>
              </HStack>
            ))}
          </VStack>
        </Section>

        <Section title="간격 x-스케일">
          <VStack gap="x1">
            {spacingSteps.map((s) => (
              <HStack key={s} gap="x3">
                <Box width={48}>
                  <Text textStyle="captionSm" color="fg.neutral-subtle">
                    {s}
                  </Text>
                </Box>
                <Box height={12} width={s} bg="bg.brand-solid" />
              </HStack>
            ))}
          </VStack>
        </Section>

        <Section title="라운드 · 그림자">
          <Flex gap="x4" wrap>
            {radiusSteps.map((r) => (
              <VStack key={r} gap="x1" align="center">
                <Box
                  width={56}
                  height={56}
                  bg="bg.neutral-weak"
                  borderRadius={r}
                />
                <Text textStyle="captionSm" color="fg.neutral-subtle">
                  {r}
                </Text>
              </VStack>
            ))}
            {shadowSteps.map((s) => (
              <VStack key={s} gap="x1" align="center">
                <Box
                  width={56}
                  height={56}
                  bg="bg.layer-floating"
                  borderRadius="r3"
                  boxShadow={s}
                />
                <Text textStyle="captionSm" color="fg.neutral-subtle">
                  {s}
                </Text>
              </VStack>
            ))}
          </Flex>
        </Section>

        <Section title="반응형 Grid (base 2 / md 3 / lg 4)">
          <Grid columns={{ base: 2, md: 3, lg: 4 }} gap="x4">
            {Array.from({ length: 8 }, (_, i) => (
              <Box
                key={i}
                position="relative"
                bg="bg.layer-default"
                borderColor="stroke.neutral-weak"
                borderRadius="r3"
                borderWidth={1}
                p="x4"
                boxShadow="s1"
              >
                <VStack gap="x2">
                  <Box height={64} bg="bg.neutral-weak" borderRadius="r2" />
                  <Text textStyle="label" maxLines={1}>
                    상품 카드 {i + 1}
                  </Text>
                  <Text textStyle="captionSm" color="fg.neutral-muted">
                    ₩12,000
                  </Text>
                </VStack>
                <Float placement="top-end" offsetX="x2" offsetY="x2">
                  <Box
                    bg="bg.critical-solid"
                    borderRadius="full"
                    px="x2"
                    py="x0_5"
                  >
                    <Text textStyle="captionSm" color="fg.contrast">
                      SALE
                    </Text>
                  </Box>
                </Float>
              </Box>
            ))}
          </Grid>
        </Section>

        <Section title="아이콘">
          <HStack gap="x4">
            {[16, 20, 24, 32].map((size) => (
              <Icon key={size} svg={<ShoppingBagIcon />} size={size} />
            ))}
            <Icon
              svg={<ShoppingBagIcon />}
              size={24}
              color="fg.critical"
              aria-label="장바구니"
            />
          </HStack>
        </Section>

        <Section title="Button">
          <VStack gap="x3">
            {(["sm", "md", "lg"] as const).map((size) => (
              <HStack key={size} gap="x3">
                <Button size={size}>주문하기</Button>
                <Button size={size} variant="secondary">
                  담기
                </Button>
                <Button size={size} variant="ghost">
                  취소
                </Button>
                <Button size={size} variant="danger">
                  삭제
                </Button>
                <Button size={size} disabled>
                  품절
                </Button>
              </HStack>
            ))}
          </VStack>
        </Section>
      </VStack>
    </Box>
  );
}

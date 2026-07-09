import {
  Box,
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
  VStack,
} from "@essesion/shared";
import { ShoppingBagIcon } from "@heroicons/react/24/outline";

import { Section } from "../section";

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

function Swatch({ token }: { token: string }) {
  return (
    <HStack gap="x3" minWidth={0}>
      <Box
        width={40}
        height={24}
        bg={token}
        borderColor="stroke.neutral-weak"
        borderRadius="r1"
        borderWidth={1}
      />
      <Text textStyle="captionSm" color="fg.neutral-muted" maxLines={1}>
        {token}
      </Text>
    </HStack>
  );
}

export function TokensSection() {
  return (
    <>
      <Section title="시맨틱 컬러">
        <Grid columns={{ base: 1, md: 3, lg: 4 }} gap="x3">
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
            <HStack key={name} gap="x4" wrap>
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
          {Array.from({ length: 4 }, (_, i) => (
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
        <HStack gap="x4" wrap>
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
    </>
  );
}

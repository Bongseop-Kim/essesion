import { Box, Grid, ImageFrame, Text, VStack } from "@essesion/shared";

import { Section } from "./section";

const PARTNERS = [
  { name: "경찰청", image: "/images/home/partner-police.png" },
  { name: "교정본부", image: "/images/home/partner-corrections.png" },
  { name: "대전", image: "/images/home/partner-daejeon.png" },
  { name: "우체국", image: "/images/home/partner-post.png" },
];

export function Partners() {
  return (
    <Section py={{ base: "x12", md: "x16" }}>
      <VStack gap={{ base: "x6", md: "x9" }} align="center">
        <VStack gap="x1_5" align="center">
          <Text as="h2" textStyle="title2" align="center">
            믿고 맡길 수 있는 제작 경험
          </Text>
          <Text textStyle="caption" color="fg.neutral-muted" align="center">
            관공서·기업·단체 납품 경험을 바탕으로 꼼꼼하게 제작합니다
          </Text>
        </VStack>
        <Grid
          columns={{ base: 2, md: 4 }}
          gap={{ base: "x3", md: "x8" }}
          width="full"
        >
          {PARTNERS.map((p) => (
            <Box
              key={p.name}
              bg="bg.neutral-weak"
              borderRadius="r2"
              px={{ base: "x6", md: "x10" }}
              py={{ base: "x5", md: "x6" }}
            >
              {/* fit="contain" — 로고 전체가 잘리지 않고 레터박스로 (shared ImageFrame D4).
                  ratio 넓게 + 좌우 여백 크게 → 로고가 더 작게, 주변 여백 넉넉하게 */}
              <ImageFrame
                ratio={4}
                fit="contain"
                borderRadius={0}
                src={p.image}
                alt={`${p.name} 로고`}
                loading="lazy"
              />
            </Box>
          ))}
        </Grid>
      </VStack>
    </Section>
  );
}

import { Box, Flex, Grid, ImageFrame, ScrollFog } from "@essesion/shared";
import { Link } from "react-router";

import { Section, SectionHeader } from "./section";

const ITEMS: { alt: string; image: string; main?: boolean }[] = [
  {
    alt: "AI로 만든 넥타이 디자인",
    image: "/images/home/tile.png",
    main: true,
  },
  { alt: "AI 넥타이 디자인 예시 1", image: "/images/home/1.png" },
  { alt: "AI 넥타이 디자인 예시 2", image: "/images/home/2.png" },
  { alt: "AI 넥타이 디자인 예시 3", image: "/images/home/3.png" },
  { alt: "AI 넥타이 디자인 예시 4", image: "/images/home/4.png" },
];

const DESIGN_HREF = "/design";

export function Lookbook() {
  return (
    <Section>
      <SectionHeader
        title="문장 하나로 만드는 넥타이 디자인"
        more="AI 디자인 생성"
        href={DESIGN_HREF}
      />

      {/* 모바일 — 가로 스냅 스크롤 */}
      <Box display={{ base: "block", md: "none" }} pt="x1">
        <ScrollFog direction="horizontal" className="snap-x snap-mandatory">
          <Flex gap="x2">
            {ITEMS.map((it) => (
              <Box
                key={it.image}
                as={Link}
                to={DESIGN_HREF}
                display="block"
                flex="0 0 62%"
                className="snap-start"
              >
                <ImageFrame
                  ratio={3 / 4}
                  borderRadius="r2"
                  src={it.image}
                  alt={it.alt}
                  loading={it.main ? "eager" : "lazy"}
                />
              </Box>
            ))}
          </Flex>
        </ScrollFog>
      </Box>

      {/* 데스크톱 — 벤토 그리드 (2fr·1fr·1fr, 2행, main이 2행 span) */}
      <Grid
        display={{ base: "none", md: "grid" }}
        templateColumns="2fr 1fr 1fr"
        gap="x3"
        pt="x1"
        style={{ gridTemplateRows: "232px 232px" }}
      >
        {ITEMS.map((it) => (
          <Box
            key={it.image}
            as={Link}
            to={DESIGN_HREF}
            position="relative"
            overflow="hidden"
            borderRadius="r2"
            gridRow={it.main ? "span 2" : undefined}
            className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
          >
            <ImageFrame
              fill
              src={it.image}
              alt={it.alt}
              loading={it.main ? "eager" : "lazy"}
            />
          </Box>
        ))}
      </Grid>
    </Section>
  );
}

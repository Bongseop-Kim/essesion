import { Box, Float, Grid, ImageFrame, Text, VStack } from "@essesion/shared";
import { Link } from "react-router";

import { Scrim } from "./scrim";
import { Section, SectionHeader } from "./section";

export type CaseItem = { nm: string; desc: string; image: string };

/** 주문제작·수선 공용 — 이미지 카드 2개 위에 스크림+캡션, 카드 전체가 href 링크. */
export function CaseSection({
  title,
  more,
  href,
  items,
}: {
  title: string;
  more: string;
  href: string;
  items: CaseItem[];
}) {
  return (
    <Section>
      <SectionHeader title={title} more={more} href={href} />
      <Grid columns={{ base: 1, md: 2 }} gap={{ base: "x3", md: "x4" }} pt="x1">
        {items.map((it, i) => (
          <Box
            key={it.nm}
            as={Link}
            to={href}
            display="block"
            className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
          >
            <ImageFrame
              ratio={5 / 4}
              borderRadius="r2"
              src={it.image}
              alt={it.nm}
              loading={i === 0 ? "eager" : "lazy"}
            >
              <Scrim from="bottom" />
              <Float placement="bottom-start" offsetX="x5" offsetY="x5">
                <VStack gap="x1">
                  <Text as="h3" textStyle="title3" color="fg.contrast">
                    {it.nm}
                  </Text>
                  <Text textStyle="caption" color="fg.contrast">
                    {it.desc}
                  </Text>
                </VStack>
              </Float>
            </ImageFrame>
          </Box>
        ))}
      </Grid>
    </Section>
  );
}

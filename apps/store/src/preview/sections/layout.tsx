import {
  Box,
  Chip,
  Footer,
  FooterLink,
  FooterSection,
  HStack,
  LayoutContent,
  List,
  ListItem,
  PullToRefresh,
  ScrollFog,
  Text,
  VStack,
} from "@essesion/shared";

import { Section, SubSection } from "../section";

export function LayoutSection() {
  return (
    <Section title="레이아웃 · 스크롤">
      <SubSection title="LayoutContent — density">
        <VStack gap="x2">
          {(["low", "medium", "high"] as const).map((density) => (
            <Box
              key={density}
              borderColor="stroke.neutral-weak"
              borderWidth={1}
              borderRadius="r2"
            >
              <LayoutContent density={density}>
                <Box bg="bg.neutral-weak" borderRadius="r1" px="x2" py="x1">
                  <Text textStyle="captionSm" color="fg.neutral-muted">
                    density={density}
                  </Text>
                </Box>
              </LayoutContent>
            </Box>
          ))}
        </VStack>
      </SubSection>

      <SubSection title="Footer">
        <Box borderColor="stroke.neutral-weak" borderWidth={1}>
          <Footer>
            <VStack gap="x6" alignItems="start">
              <HStack gap="x16" alignItems="start">
                <FooterSection title="회사">
                  <FooterLink href="#">회사 소개</FooterLink>
                  <FooterLink href="#">이용약관</FooterLink>
                  <FooterLink href="#">개인정보처리방침</FooterLink>
                </FooterSection>
                <FooterSection title="고객센터">
                  <FooterLink href="#">자주 묻는 질문</FooterLink>
                  <FooterLink href="#">1:1 문의</FooterLink>
                </FooterSection>
              </HStack>
              <Text textStyle="captionSm" color="fg.neutral-subtle">
                © 2026 되고시스템
              </Text>
            </VStack>
          </Footer>
        </Box>
      </SubSection>

      <SubSection title="ScrollFog — vertical · horizontal">
        <HStack gap="x6" alignItems="start">
          <Box
            width={240}
            borderColor="stroke.neutral-weak"
            borderWidth={1}
            borderRadius="r2"
          >
            <ScrollFog style={{ height: 160 }}>
              <List>
                {Array.from({ length: 12 }, (_, i) => (
                  <ListItem key={i} title={`옵션 ${i + 1}`} />
                ))}
              </List>
            </ScrollFog>
          </Box>
          <Box width={280}>
            <ScrollFog direction="horizontal">
              <HStack gap="x2" py="x1">
                {Array.from({ length: 10 }, (_, i) => (
                  <Chip key={i}>카테고리 {i + 1}</Chip>
                ))}
              </HStack>
            </ScrollFog>
          </Box>
        </HStack>
      </SubSection>

      <SubSection title="PullToRefresh (터치 기기에서 당겨보세요)">
        <Box
          width={280}
          height={200}
          borderColor="stroke.neutral-weak"
          borderWidth={1}
          borderRadius="r2"
          overflow="hidden"
        >
          <PullToRefresh
            onRefresh={() =>
              new Promise((resolve) => setTimeout(resolve, 1000))
            }
            className="h-full"
          >
            <List>
              {Array.from({ length: 8 }, (_, i) => (
                <ListItem key={i} title={`주문 내역 ${i + 1}`} />
              ))}
            </List>
          </PullToRefresh>
        </Box>
      </SubSection>
    </Section>
  );
}

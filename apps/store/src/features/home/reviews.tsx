import {
  Avatar,
  Flex,
  HStack,
  ScrollFog,
  Text,
  VStack,
} from "@essesion/shared";

import { Section, SectionHeader } from "./section";

const REVIEWS = [
  {
    q: "한 줄 입력했더니 시안 4개가 바로 나와서, 그중 하나로 30개 주문했어요. 결혼식 답례용이었는데 다들 좋아했어요.",
    nm: "김ㅈㅎ",
    from: "주문 제작",
  },
  {
    q: "손으로 매번 묶던 넥타이를 자동 매듭으로 바꾸니 출근 준비가 훨씬 편해졌어요.",
    nm: "이ㅅㅎ",
    from: "수선",
  },
  {
    q: "실크 도트 샀는데 매듭이 잘 잡혀요. 가격도 부담 없고, 다음에는 다른 색도 사 볼래요.",
    nm: "박ㄱㅁ",
    from: "스토어",
  },
];

export function Reviews() {
  return (
    <Section>
      <SectionHeader title="먼저 써본 분들 이야기" />
      <ScrollFog direction="horizontal" className="snap-x snap-mandatory">
        <Flex gap="x3" pt="x1" align="stretch">
          {REVIEWS.map((r) => (
            <VStack
              key={r.nm}
              flex={{ base: "0 0 80%", md: "1 1 0" }}
              gap="x4"
              p="x5"
              bg="bg.neutral-weak"
              borderRadius="r2"
              className="snap-start"
            >
              <Text
                textStyle="caption"
                color="fg.neutral"
                aria-label="별점 5점 만점에 5점"
              >
                ★★★★★
              </Text>
              <Text textStyle="body" color="fg.neutral">
                {r.q}
              </Text>
              <HStack gap="x2_5">
                <Avatar name={r.nm} size={36} />
                <VStack gap="x0_5">
                  <Text textStyle="labelSm" color="fg.neutral">
                    {r.nm}
                  </Text>
                  <Text textStyle="caption" color="fg.neutral-subtle">
                    {r.from}
                  </Text>
                </VStack>
              </HStack>
            </VStack>
          ))}
        </Flex>
      </ScrollFog>
    </Section>
  );
}

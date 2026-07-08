import {
  SegmentedControl,
  SegmentedControlItem,
  TabContent,
  TabList,
  Tabs,
  TabTrigger,
  Text,
  VStack,
} from "@essesion/shared";

import { Section, SubSection } from "../section";

export function NavigationSection() {
  return (
    <Section title="내비게이션">
      <SubSection title="Tabs — hug(기본)">
        <Tabs defaultValue="detail">
          <TabList aria-label="상품 정보">
            <TabTrigger value="detail">상세 정보</TabTrigger>
            <TabTrigger value="review">리뷰</TabTrigger>
            <TabTrigger value="qna" disabled>
              문의
            </TabTrigger>
          </TabList>
          <TabContent value="detail" className="py-x4">
            <Text textStyle="body">상품의 소재·사이즈·배송 정보를 봅니다.</Text>
          </TabContent>
          <TabContent value="review" className="py-x4">
            <Text textStyle="body">구매자 리뷰 3,204개를 봅니다.</Text>
          </TabContent>
          <TabContent value="qna" className="py-x4">
            <Text textStyle="body">상품 문의를 봅니다.</Text>
          </TabContent>
        </Tabs>
      </SubSection>

      <SubSection title="Tabs — fill(균등 분할)">
        <Tabs defaultValue="ongoing">
          <TabList triggerLayout="fill" aria-label="주문 상태">
            <TabTrigger value="ongoing">진행 중</TabTrigger>
            <TabTrigger value="done">완료</TabTrigger>
            <TabTrigger value="canceled">취소·환불</TabTrigger>
          </TabList>
          <TabContent value="ongoing" className="py-x4">
            <Text textStyle="body">진행 중인 주문을 봅니다.</Text>
          </TabContent>
          <TabContent value="done" className="py-x4">
            <Text textStyle="body">완료된 주문을 봅니다.</Text>
          </TabContent>
          <TabContent value="canceled" className="py-x4">
            <Text textStyle="body">취소·환불된 주문을 봅니다.</Text>
          </TabContent>
        </Tabs>
      </SubSection>

      <SubSection title="SegmentedControl">
        <VStack gap="x3" alignItems="start">
          <SegmentedControl defaultValue="recommend" aria-label="정렬 기준">
            <SegmentedControlItem value="recommend">
              추천순
            </SegmentedControlItem>
            <SegmentedControlItem value="latest">최신순</SegmentedControlItem>
            <SegmentedControlItem value="price" disabled>
              가격순
            </SegmentedControlItem>
          </SegmentedControl>
        </VStack>
      </SubSection>
    </Section>
  );
}

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  ActionButton,
  Article,
  Box,
  ContentPlaceholder,
  Icon,
  List,
  ListHeader,
  ListItem,
  ResultSection,
  Text,
  VStack,
} from "@essesion/shared";
import { InboxIcon } from "@heroicons/react/24/outline";

import { Section, SubSection } from "../section";

export function ContentSection() {
  return (
    <Section title="콘텐츠">
      <SubSection title="List">
        <Box
          borderWidth={1}
          borderColor="stroke.neutral-weak"
          borderRadius="r3"
          overflow="hidden"
        >
          <List>
            <ListHeader>주문·배송</ListHeader>
            <ListItem title="주문 내역" />
            <ListItem title="배송 조회" onClick={() => undefined} />
            <ListItem
              title="상품 리뷰"
              description="작성한 리뷰 8건"
              suffix={
                <Text textStyle="caption" color="fg.neutral-subtle">
                  더보기
                </Text>
              }
            />
          </List>
        </Box>
      </SubSection>

      <SubSection title="Accordion — inline">
        <Accordion defaultValue="shipping">
          <AccordionItem value="shipping">
            <AccordionTrigger>배송 안내</AccordionTrigger>
            <AccordionContent>
              주문 후 평균 2~3일 이내에 순차 배송됩니다. 도서·산간 지역은 하루
              더 소요될 수 있습니다.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="return">
            <AccordionTrigger>교환·반품</AccordionTrigger>
            <AccordionContent>
              상품 수령 후 7일 이내에 마이페이지에서 신청할 수 있습니다.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </SubSection>

      <SubSection title="Accordion — separated">
        <Accordion
          variant="separated"
          type="multiple"
          defaultValue={["payment"]}
        >
          <AccordionItem value="payment">
            <AccordionTrigger>결제 수단</AccordionTrigger>
            <AccordionContent>
              신용카드, 계좌이체, 간편결제를 지원합니다.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="receipt">
            <AccordionTrigger>영수증 발급</AccordionTrigger>
            <AccordionContent>
              결제 완료 후 현금영수증과 세금계산서를 발급할 수 있습니다.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </SubSection>

      <SubSection title="Article">
        <Article>
          <VStack gap="x3">
            <Text textStyle="body">
              이 상품은 자연 소재를 사용해 한 점씩 손으로 마감했습니다. 색과
              결은 개체마다 조금씩 다를 수 있습니다.
            </Text>
            <Text textStyle="body">
              사용 후에는 직사광선을 피해 통풍이 잘 되는 곳에 보관해 주세요.
            </Text>
          </VStack>
        </Article>
      </SubSection>

      <SubSection title="ContentPlaceholder">
        <ContentPlaceholder
          icon={<Icon svg={<InboxIcon />} size={48} />}
          title="주문 내역이 없어요"
          description="첫 주문을 시작해 보세요."
          action={
            <ActionButton variant="neutralWeak" size="medium">
              쇼핑하러 가기
            </ActionButton>
          }
        />
      </SubSection>

      <SubSection title="ResultSection">
        <Box
          height={380}
          display="flex"
          borderWidth={1}
          borderColor="stroke.neutral-weak"
          borderRadius="r3"
        >
          <ResultSection
            size="medium"
            title="결과를 찾을 수 없어요"
            description="다른 검색어로 다시 시도해 보세요."
            primaryActionProps={{ children: "다시 검색" }}
            secondaryActionProps={{ children: "홈으로" }}
          />
        </Box>
      </SubSection>
    </Section>
  );
}

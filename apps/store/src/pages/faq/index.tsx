import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Article,
  Badge,
  Text,
  VStack,
} from "@essesion/shared";

import { VISIBLE_FAQS } from "@/pages/faq/model/faq-data";
import { applyTemplateTokens } from "@/shared/lib/template-tokens";
import { useReformPricingTokens } from "@/shared/lib/use-reform-pricing-tokens";
import { ContentLayout } from "@/shared/ui/content-layout";

export function FaqPage() {
  const { feeTokens, pricingStatus } = useReformPricingTokens();

  return (
    <>
      <title>자주 묻는 질문 | ESSE SION</title>
      <meta
        name="description"
        content="ESSE SION의 배송, 주문, 맞춤 제작, 수선과 디자인 토큰 이용 방법을 안내합니다."
      />
      <ContentLayout
        breadcrumbs={[{ label: "홈", href: "/" }, { label: "자주 묻는 질문" }]}
      >
        <VStack gap="x8" alignItems="stretch">
          <VStack gap="x2" alignItems="stretch">
            <Text as="h1" textStyle="title1">
              자주 묻는 질문
            </Text>
            <Text as="p" textStyle="body" color="fg.neutral-muted">
              배송, 주문, 수선과 제작 서비스의 자주 찾는 답변을 모았습니다.
            </Text>
          </VStack>

          <VStack gap="x3" alignItems="stretch">
            {pricingStatus ? (
              <Text
                as="p"
                textStyle="caption"
                color="fg.neutral-muted"
                aria-live="polite"
              >
                {pricingStatus}
              </Text>
            ) : null}
            <Accordion type="single" collapsible>
              {VISIBLE_FAQS.map((faq) => (
                <AccordionItem key={faq.id} value={faq.id}>
                  <AccordionTrigger>
                    <VStack gap="x2" alignItems="flex-start">
                      <Badge>{faq.category}</Badge>
                      <Text textStyle="label" color="fg.neutral">
                        {faq.question}
                      </Text>
                    </VStack>
                  </AccordionTrigger>
                  <AccordionContent>
                    <Article bg="bg.neutral-weak" borderRadius="r2" p="x4">
                      <Text
                        as="p"
                        textStyle="bodySm"
                        color="fg.neutral-muted"
                        className="whitespace-pre-line"
                      >
                        {applyTemplateTokens(faq.answer, feeTokens)}
                      </Text>
                    </Article>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </VStack>
        </VStack>
      </ContentLayout>
    </>
  );
}

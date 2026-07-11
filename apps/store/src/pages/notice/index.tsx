import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Article,
  Badge,
  HStack,
  Text,
  VStack,
} from "@essesion/shared";

import { getVisibleNotices } from "@/pages/notice/model/notice-data";
import { applyTemplateTokens } from "@/shared/lib/template-tokens";
import { useReformPricingTokens } from "@/shared/lib/use-reform-pricing-tokens";
import { ContentLayout } from "@/shared/ui/content-layout";

const notices = getVisibleNotices();

export function NoticePage() {
  const { feeTokens, pricingStatus } = useReformPricingTokens();

  return (
    <>
      <title>공지사항 | ESSE SION</title>
      <meta
        name="description"
        content="ESSE SION 서비스 운영, 주문, 결제, 수선과 제작 관련 공지사항을 확인하세요."
      />
      <ContentLayout
        breadcrumbs={[{ label: "홈", href: "/" }, { label: "공지사항" }]}
      >
        <VStack gap="x8" alignItems="stretch">
          <VStack gap="x2" alignItems="stretch">
            <Text as="h1" textStyle="title1">
              공지사항
            </Text>
            <Text as="p" textStyle="body" color="fg.neutral-muted">
              서비스 운영과 정책 변경 소식을 확인할 수 있습니다.
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
              {notices.map((notice) => (
                <AccordionItem key={notice.id} value={notice.id}>
                  <AccordionTrigger>
                    <VStack gap="x2" alignItems="flex-start" width="full">
                      <HStack gap="x2" flexWrap width="full">
                        {notice.pinned ? (
                          <Badge tone="critical">중요</Badge>
                        ) : null}
                        <Badge>{notice.category}</Badge>
                        <Text
                          as="time"
                          dateTime={notice.published_at}
                          textStyle="caption"
                          color="fg.neutral-muted"
                          ml="auto"
                        >
                          {notice.published_at.replaceAll("-", ".")}
                        </Text>
                      </HStack>
                      <Text textStyle="label" color="fg.neutral">
                        {notice.title}
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
                        {applyTemplateTokens(notice.content, feeTokens)}
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

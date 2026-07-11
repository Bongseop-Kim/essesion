import type { QuoteOut } from "@essesion/api-client";
import { listMyQuotesOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  Badge,
  Chip,
  ContentPlaceholder,
  HStack,
  List,
  ListHeader,
  ListItem,
  ScrollFog,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";

import {
  formatQuoteAmount,
  QUOTE_REQUEST_FILTERS,
  type QuoteRequestFilter,
  quoteContactMethodLabel,
  quoteContactName,
  quoteRequestStatusTone,
} from "@/features/quote-request/model/config";
import { groupByCreatedDate } from "@/shared/lib/date-groups";
import { ContentLayout } from "@/shared/ui/content-layout";

export function QuoteRequestPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<QuoteRequestFilter>("all");
  const quotesQuery = useQuery(listMyQuotesOptions());
  const quotes = (quotesQuery.data ?? []).filter(
    (quote) => filter === "all" || quote.status === filter,
  );
  const groups = groupByCreatedDate(quotes);

  return (
    <>
      <title>견적 요청 내역 | ESSE SION</title>
      <meta
        name="description"
        content="주문 제작 견적 요청과 진행 상태를 확인하세요."
      />
      <ContentLayout
        breadcrumbs={[
          { label: "홈", href: "/" },
          { label: "마이페이지", href: "/my-page" },
          { label: "견적 요청 내역" },
        ]}
      >
        <VStack gap="x6" alignItems="stretch">
          <VStack gap="x1">
            <Text as="h1" textStyle="title1">
              견적 요청 내역
            </Text>
            <Text textStyle="caption" color="fg.neutral-muted">
              주문 제작 상담과 견적 진행 상태를 확인합니다.
            </Text>
          </VStack>

          <ScrollFog direction="horizontal">
            <HStack gap="x2">
              {QUOTE_REQUEST_FILTERS.map((option) => (
                <Chip
                  key={option.value}
                  selected={filter === option.value}
                  onClick={() => setFilter(option.value)}
                >
                  {option.label}
                </Chip>
              ))}
            </HStack>
          </ScrollFog>

          {quotesQuery.isPending ? (
            <QuoteRequestListSkeleton />
          ) : quotesQuery.isError ? (
            <ContentPlaceholder
              title="견적 요청 내역을 불러오지 못했습니다"
              description="잠시 후 다시 시도해 주세요."
              action={
                <ActionButton
                  type="button"
                  variant="neutralOutline"
                  onClick={() => void quotesQuery.refetch()}
                >
                  다시 시도
                </ActionButton>
              }
            />
          ) : quotes.length === 0 ? (
            <ContentPlaceholder
              title={
                filter === "all"
                  ? "견적 요청 내역이 없습니다"
                  : "해당 상태의 견적 요청이 없습니다"
              }
              description={
                filter === "all"
                  ? "주문 제작에서 100개 이상 수량의 견적을 요청할 수 있습니다."
                  : "다른 상태를 선택해 보세요."
              }
              action={
                filter === "all" ? (
                  <ActionButton
                    type="button"
                    variant="neutralOutline"
                    onClick={() => navigate("/custom-order")}
                  >
                    견적 요청하기
                  </ActionButton>
                ) : undefined
              }
            />
          ) : (
            <VStack gap="x4" alignItems="stretch">
              {groups.map(([date, dateQuotes]) => (
                <VStack key={date} gap="x1" alignItems="stretch">
                  <ListHeader variant="boldSolid">{date}</ListHeader>
                  <List>
                    {dateQuotes.map((quote) => (
                      <ListItem
                        key={quote.id}
                        title={`견적번호 ${quote.quote_number}`}
                        description={`${quote.quantity.toLocaleString("ko-KR")}개 · 담당자 ${quoteContactName(quote.contact_name, quote.business_name)} · 연락 ${quoteContactMethodLabel(quote.contact_method)}`}
                        suffix={<QuoteStatus quote={quote} />}
                        onClick={() =>
                          navigate(`/my-page/quote-request/${quote.id}`)
                        }
                      />
                    ))}
                  </List>
                </VStack>
              ))}
            </VStack>
          )}
        </VStack>
      </ContentLayout>
    </>
  );
}

function QuoteStatus({
  quote,
}: {
  quote: Pick<QuoteOut, "quoted_amount" | "status">;
}) {
  return (
    <VStack as="span" gap="x1" alignItems="flex-end">
      <Badge tone={quoteRequestStatusTone(quote.status)}>{quote.status}</Badge>
      {quote.quoted_amount !== null ? (
        <Text as="span" textStyle="labelSm" color="fg.neutral">
          {formatQuoteAmount(quote.quoted_amount)}
        </Text>
      ) : null}
    </VStack>
  );
}

function QuoteRequestListSkeleton() {
  return (
    <VStack gap="x3" alignItems="stretch">
      <Skeleton width="100%" height={96} />
      <Skeleton width="100%" height={96} />
      <Skeleton width="100%" height={96} />
    </VStack>
  );
}

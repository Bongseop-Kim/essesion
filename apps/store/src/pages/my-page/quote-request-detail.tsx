import { createReadUrl } from "@essesion/api-client";
import { getQuoteOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  AspectRatio,
  Badge,
  Box,
  ContentPlaceholder,
  Divider,
  Grid,
  HStack,
  ImageFrame,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode } from "react";
import { Navigate, useNavigate, useParams } from "react-router";

import { customOrderSummary } from "@/features/custom-order";
import {
  formatQuoteAmount,
  formatQuoteDate,
  quoteContactMethodLabel,
  quoteCustomOrderOptions,
  quoteReferenceImageKeys,
  quoteRequestStatusTone,
} from "@/features/quote-request";
import { ContentLayout } from "@/shared/ui/content-layout";
import { SummaryCard } from "@/shared/ui/summary-card";

const LIST_PATH = "/my-page/quote-request";

export function QuoteRequestDetailPage() {
  const { quoteId } = useParams();
  const navigate = useNavigate();
  const quoteQuery = useQuery({
    ...getQuoteOptions({ path: { quote_id: quoteId ?? "" } }),
    enabled: !!quoteId,
  });
  const quote = quoteQuery.data;
  const imageKeys = quoteReferenceImageKeys(quote?.reference_images ?? []);
  const imageQueries = useQueries({
    queries: imageKeys.map((objectKey) => ({
      queryKey: ["quote-reference-image", objectKey],
      queryFn: async () => {
        const response = await createReadUrl({
          body: { object_key: objectKey },
          throwOnError: true,
        });
        return response.data.read_url;
      },
    })),
  });

  if (!quoteId) return <Navigate to={LIST_PATH} replace />;

  const specification = quote
    ? customOrderSummary(
        quoteCustomOrderOptions(
          quote.options,
          quote.quantity,
          quote.additional_notes,
        ),
      )
    : [];
  const sidebar = quote ? (
    <SummaryCard.Root>
      <SummaryCard.Section
        title="견적 요약"
        description="담당자가 확인한 진행 상태와 견적입니다."
      />
      <Divider />
      <SummaryCard.Row
        label="상태"
        value={
          <Badge tone={quoteRequestStatusTone(quote.status)}>
            {quote.status}
          </Badge>
        }
      />
      <SummaryCard.Total
        label="견적 금액"
        value={
          quote.quoted_amount === null
            ? "검토 중"
            : formatQuoteAmount(quote.quoted_amount)
        }
      />
      <Divider />
      <VStack gap="x1" alignItems="stretch">
        <Text as="h3" textStyle="labelSm">
          견적 조건
        </Text>
        <Text
          as="p"
          textStyle="bodySm"
          color="fg.neutral-muted"
          style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
        >
          {quote.quote_conditions || "견적 발송 후 안내해 드립니다."}
        </Text>
      </VStack>
    </SummaryCard.Root>
  ) : quoteQuery.isPending ? (
    <Skeleton width="100%" height={280} />
  ) : undefined;

  return (
    <>
      <title>
        {quote
          ? `${quote.quote_number} 견적 | ESSE SION`
          : "견적 요청 상세 | ESSE SION"}
      </title>
      <meta
        name="description"
        content="주문 제작 견적의 사양과 진행 상태를 확인하세요."
      />
      <ContentLayout
        breadcrumbs={[
          { label: "홈", href: "/" },
          { label: "견적 요청 내역", href: LIST_PATH },
          { label: "견적 요청 상세" },
        ]}
        sidebar={sidebar}
        actionBar={
          quote ? (
            <Box
              as={ActionButton}
              type="button"
              variant="neutralOutline"
              width="full"
              onClick={() => navigate(LIST_PATH)}
            >
              목록으로
            </Box>
          ) : undefined
        }
      >
        {quoteQuery.isPending ? (
          <QuoteRequestDetailSkeleton />
        ) : quoteQuery.isError || !quote ? (
          <ContentPlaceholder
            title="견적 요청을 불러오지 못했습니다"
            description="견적 요청 내역에서 다시 확인해 주세요."
            action={
              <HStack gap="x2" wrap>
                <ActionButton
                  type="button"
                  variant="neutralOutline"
                  onClick={() => void quoteQuery.refetch()}
                >
                  다시 시도
                </ActionButton>
                <ActionButton
                  type="button"
                  variant="ghost"
                  onClick={() => navigate(LIST_PATH)}
                >
                  목록으로
                </ActionButton>
              </HStack>
            }
          />
        ) : (
          <VStack gap="x6" alignItems="stretch">
            <VStack gap="x2">
              <HStack gap="x3" wrap>
                <Text as="h1" textStyle="title1">
                  견적 요청 상세
                </Text>
                <Badge tone={quoteRequestStatusTone(quote.status)}>
                  {quote.status}
                </Badge>
              </HStack>
              <Text textStyle="caption" color="fg.neutral-muted">
                {quote.quote_number}
              </Text>
            </VStack>

            <DetailSection title="기본 정보">
              <InfoRows
                rows={[
                  { label: "요청일", value: formatQuoteDate(quote.created_at) },
                  {
                    label: "수량",
                    value: `${quote.quantity.toLocaleString("ko-KR")}개`,
                  },
                  {
                    label: "추가 요청사항",
                    value:
                      quote.additional_notes || "추가 요청사항이 없습니다.",
                  },
                ]}
              />
            </DetailSection>

            <DetailSection title="연락처">
              <InfoRows
                rows={[
                  { label: "담당자", value: quote.contact_name },
                  ...(quote.business_name
                    ? [{ label: "상호명", value: quote.business_name }]
                    : []),
                  {
                    label: "연락 방법",
                    value: quoteContactMethodLabel(quote.contact_method),
                  },
                  { label: "연락처", value: quote.contact_value },
                ]}
              />
            </DetailSection>

            <DetailSection title="제작 사양">
              <InfoRows rows={specification} />
            </DetailSection>

            {imageKeys.length > 0 ? (
              <VStack gap="x3" alignItems="stretch">
                <VStack gap="x1">
                  <Text as="h2" textStyle="title3">
                    참고 이미지
                  </Text>
                  <Text textStyle="caption" color="fg.neutral-muted">
                    확정 또는 종료 후 보관 기간이 지나면 이미지를 불러올 수
                    없습니다.
                  </Text>
                </VStack>
                <Grid columns={{ base: 2, md: 3 }} gap="x3">
                  {imageKeys.map((objectKey, index) => {
                    const imageQuery = imageQueries[index];
                    return imageQuery?.isPending ? (
                      <AspectRatio
                        key={objectKey}
                        ratio={1}
                        className="rounded-r2"
                      >
                        <Skeleton
                          width="100%"
                          height="100%"
                          radius={0}
                          className="absolute inset-0"
                        />
                      </AspectRatio>
                    ) : (
                      <ImageFrame
                        key={objectKey}
                        ratio={1}
                        src={imageQuery?.data}
                        alt={`견적 참고 이미지 ${index + 1}`}
                        borderRadius="r2"
                        fit="contain"
                        stroke
                        loading="lazy"
                        fallback={<ReferenceImageFallback />}
                      />
                    );
                  })}
                </Grid>
              </VStack>
            ) : null}
          </VStack>
        )}
      </ContentLayout>
    </>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <VStack gap="x3" alignItems="stretch">
      <Text as="h2" textStyle="title3">
        {title}
      </Text>
      <Box
        bg="bg.layer-default"
        borderWidth={1}
        borderColor="stroke.neutral-weak"
        borderRadius="r3"
        p={{ base: "x4", md: "x5" }}
      >
        {children}
      </Box>
    </VStack>
  );
}

function InfoRows({
  rows,
}: {
  rows: readonly { label: string; value: string }[];
}) {
  return (
    <VStack gap="x3" alignItems="stretch">
      {rows.map((row, index) => (
        <Fragment key={row.label}>
          {index > 0 ? <Divider /> : null}
          <HStack justify="space-between" gap="x4" align="flex-start">
            <Text textStyle="bodySm" color="fg.neutral-muted">
              {row.label}
            </Text>
            <Text
              textStyle="bodySm"
              align="end"
              style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
            >
              {row.value}
            </Text>
          </HStack>
        </Fragment>
      ))}
    </VStack>
  );
}

function ReferenceImageFallback() {
  return (
    <VStack
      position="absolute"
      inset={0}
      align="center"
      justify="center"
      bg="bg.neutral-weak"
      p="x3"
    >
      <Text textStyle="caption" color="fg.neutral-muted" align="center">
        이미지를 불러올 수 없습니다.
      </Text>
    </VStack>
  );
}

function QuoteRequestDetailSkeleton() {
  return (
    <VStack gap="x4" alignItems="stretch">
      <Skeleton width="45%" height={32} />
      <Skeleton width="100%" height={144} />
      <Skeleton width="100%" height={180} />
      <Skeleton width="100%" height={220} />
    </VStack>
  );
}

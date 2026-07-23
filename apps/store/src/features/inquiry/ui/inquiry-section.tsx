import type { ListPublicInquiriesData } from "@essesion/api-client";
import { listPublicInquiriesInfiniteOptions } from "@essesion/api-client/query";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  ActionButton,
  Badge,
  Box,
  ContentPlaceholder,
  HStack,
  Icon,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import { LockClosedIcon } from "@heroicons/react/20/solid";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "react-router";

import { useAuthGuard } from "@/features/auth";
import { formatDate } from "@/shared/lib/format";
import type { InquiryCategory } from "../model/config";
import { inquiryStatusTone } from "../model/config";
import { InquiryFormModal } from "./inquiry-form-modal";

const PAGE_SIZE = 20;

type InquirySectionProps = {
  category: InquiryCategory;
  productId?: number;
};

export function InquirySection({ category, productId }: InquirySectionProps) {
  const location = useLocation();
  const { requireAuth } = useAuthGuard();
  const [formOpen, setFormOpen] = useState(false);
  const query: NonNullable<ListPublicInquiriesData["query"]> =
    category === "상품"
      ? { product_id: productId, limit: PAGE_SIZE }
      : {
          category: category as "수선" | "주문제작" | "샘플제작",
          limit: PAGE_SIZE,
        };
  const inquiriesQuery = useInfiniteQuery({
    ...listPublicInquiriesInfiniteOptions({ query }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const next = lastPage.offset + lastPage.items.length;
      return next < lastPage.total ? next : undefined;
    },
  });
  const items = inquiriesQuery.data?.pages.flatMap((page) => page.items) ?? [];

  const openForm = () => {
    if (requireAuth({ path: `${location.pathname}${location.search}` })) {
      setFormOpen(true);
    }
  };

  return (
    <VStack gap="x5" alignItems="stretch">
      <HStack justify="space-between" gap="x4" wrap>
        <VStack gap="x0_5">
          <Text as="h2" textStyle="title3">
            문의
          </Text>
          <Text textStyle="bodySm" color="fg.neutral-muted">
            공개 문의와 답변은 로그인 없이 확인할 수 있습니다.
          </Text>
        </VStack>
        <ActionButton type="button" variant="neutralOutline" onClick={openForm}>
          문의하기
        </ActionButton>
      </HStack>

      {inquiriesQuery.isPending ? (
        <VStack gap="x2" alignItems="stretch" aria-busy="true">
          <Skeleton width="100%" height={72} />
          <Skeleton width="100%" height={72} />
          <Skeleton width="100%" height={72} />
        </VStack>
      ) : inquiriesQuery.isError ? (
        <ContentPlaceholder
          title="문의를 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
          action={
            <ActionButton
              type="button"
              variant="neutralOutline"
              onClick={() => void inquiriesQuery.refetch()}
            >
              다시 시도
            </ActionButton>
          }
        />
      ) : items.length === 0 ? (
        <ContentPlaceholder
          title="등록된 문의가 없습니다"
          description="첫 문의를 남겨 보세요."
        />
      ) : (
        <Accordion type="single">
          {items.map((inquiry) => {
            const locked = inquiry.is_secret && !inquiry.is_mine;
            return (
              <AccordionItem key={inquiry.id} value={inquiry.id}>
                <AccordionTrigger disabled={locked}>
                  <HStack
                    justify="space-between"
                    gap="x3"
                    flex={1}
                    minWidth={0}
                  >
                    <VStack gap="x1" minWidth={0}>
                      <HStack gap="x2" wrap>
                        {inquiry.is_secret ? (
                          <Icon
                            svg={<LockClosedIcon />}
                            size={16}
                            aria-label="비밀글"
                          />
                        ) : null}
                        <Text textStyle="labelSm" maxLines={1}>
                          {inquiry.title}
                        </Text>
                        <Badge tone={inquiryStatusTone(inquiry.status)}>
                          {inquiry.status}
                        </Badge>
                        {inquiry.is_mine ? (
                          <Badge tone="brand">내 문의</Badge>
                        ) : null}
                      </HStack>
                      <Text textStyle="caption" color="fg.neutral-muted">
                        {inquiry.author_name} · {formatDate(inquiry.created_at)}
                      </Text>
                    </VStack>
                  </HStack>
                </AccordionTrigger>
                <AccordionContent>
                  <VStack gap="x4" alignItems="stretch">
                    <Text className="whitespace-pre-wrap break-words">
                      {inquiry.content}
                    </Text>
                    {inquiry.answer ? (
                      <Box bg="bg.neutral-weak" borderRadius="r2" p="x4">
                        <VStack gap="x1" alignItems="stretch">
                          <Text textStyle="labelSm">답변</Text>
                          <Text className="whitespace-pre-wrap break-words">
                            {inquiry.answer}
                          </Text>
                        </VStack>
                      </Box>
                    ) : null}
                  </VStack>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      {inquiriesQuery.hasNextPage ? (
        <ActionButton
          type="button"
          variant="neutralOutline"
          loading={inquiriesQuery.isFetchingNextPage}
          onClick={() => void inquiriesQuery.fetchNextPage()}
        >
          더보기
        </ActionButton>
      ) : null}

      <InquiryFormModal
        open={formOpen}
        inquiry={null}
        prefill={{ category, productId: productId ?? null }}
        onOpenChange={setFormOpen}
      />
    </VStack>
  );
}

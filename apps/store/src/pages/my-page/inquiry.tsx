import type { InquiryOut } from "@essesion/api-client";
import {
  deleteInquiryMutation,
  getProductOptions,
  listMyInquiriesOptions,
  listMyInquiriesQueryKey,
} from "@essesion/api-client/query";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  ActionButton,
  AlertDialog,
  Article,
  Badge,
  Box,
  ContentPlaceholder,
  HStack,
  ImageFrame,
  ListHeader,
  Skeleton,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import {
  InquiryFormModal,
  type InquiryPrefill,
  inquiryStatusTone,
  isInquiryEditable,
  parseInquiryPrefill,
  summarizeInquiries,
} from "@/features/inquiry";
import { groupByCreatedDate } from "@/shared/lib/date-groups";
import { formatDateTime } from "@/shared/lib/format";
import { ContentLayout } from "@/shared/ui/content-layout";
import { SummaryCard } from "@/shared/ui/summary-card";

const formatDate = (value: string | null, includeTime = false) =>
  formatDateTime(
    value,
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    },
    "-",
  );

export function InquiryPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [initialPrefill] = useState(() => parseInquiryPrefill(searchParams));
  const [formOpen, setFormOpen] = useState(initialPrefill !== null);
  const [prefill, setPrefill] = useState<InquiryPrefill | null>(initialPrefill);
  const [editingInquiry, setEditingInquiry] = useState<InquiryOut | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InquiryOut | null>(null);
  const [openInquiryIds, setOpenInquiryIds] = useState<string[]>([]);
  const inquiriesQuery = useQuery(listMyInquiriesOptions());
  const inquiries = inquiriesQuery.data ?? [];
  const groups = groupByCreatedDate(inquiries);
  const summary = summarizeInquiries(inquiries);
  const removeInquiry = useMutation(deleteInquiryMutation());

  useEffect(() => {
    if (initialPrefill === null) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("category");
        next.delete("product_id");
        next.delete("productId");
        return next;
      },
      { replace: true },
    );
  }, [initialPrefill, setSearchParams]);

  const openCreateForm = () => {
    setEditingInquiry(null);
    setPrefill(null);
    setFormOpen(true);
  };

  const openEditForm = (inquiry: InquiryOut) => {
    setEditingInquiry(inquiry);
    setPrefill(null);
    setFormOpen(true);
  };

  const changeFormOpen = (open: boolean) => {
    setFormOpen(open);
    if (!open) {
      setEditingInquiry(null);
      setPrefill(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await removeInquiry.mutateAsync({
        path: { inquiry_id: deleteTarget.id },
      });
      await queryClient.invalidateQueries({
        queryKey: listMyInquiriesQueryKey(),
      });
      setDeleteTarget(null);
      snackbar("문의를 삭제했습니다.");
    } catch {
      snackbar("문의를 삭제하지 못했습니다. 다시 시도해 주세요.");
    }
  };

  const sidebar = inquiriesQuery.isPending ? (
    <Skeleton width="100%" height={220} />
  ) : inquiriesQuery.isSuccess ? (
    <SummaryCard.Root>
      <SummaryCard.Section
        title="문의 현황"
        description="등록한 1:1 문의의 답변 상태입니다."
      />
      <SummaryCard.Row label="전체" value={`${summary.total}건`} />
      <SummaryCard.Row label="답변 대기" value={`${summary.waiting}건`} />
      <SummaryCard.Row label="답변 완료" value={`${summary.answered}건`} />
      <SummaryCard.Row
        label="최근 답변일"
        value={formatDate(summary.latestAnswerDate)}
      />
    </SummaryCard.Root>
  ) : undefined;

  return (
    <>
      <title>1:1 문의 | ESSE SION</title>
      <meta
        name="description"
        content="ESSE SION 1:1 문의를 작성하고 답변 상태를 확인하세요."
      />
      <ContentLayout
        breadcrumbs={[
          { label: "홈", href: "/" },
          { label: "마이페이지", href: "/my-page" },
          { label: "1:1 문의" },
        ]}
        sidebar={sidebar}
      >
        <VStack gap="x6" alignItems="stretch">
          <HStack justify="space-between" gap="x4" align="flex-start" wrap>
            <VStack gap="x1" alignItems="stretch">
              <Text as="h1" textStyle="title1">
                1:1 문의
              </Text>
              <Text as="p" textStyle="bodySm" color="fg.neutral-muted">
                상품과 주문, 수선 및 제작에 관해 궁금한 점을 남겨 주세요.
              </Text>
            </VStack>
            <ActionButton type="button" onClick={openCreateForm}>
              1:1 문의하기
            </ActionButton>
          </HStack>

          {inquiriesQuery.isPending ? (
            <VStack gap="x3" alignItems="stretch">
              <Skeleton width="100%" height={112} />
              <Skeleton width="100%" height={112} />
              <Skeleton width="100%" height={112} />
            </VStack>
          ) : inquiriesQuery.isError ? (
            <ContentPlaceholder
              title="문의 내역을 불러오지 못했습니다"
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
          ) : inquiries.length === 0 ? (
            <ContentPlaceholder
              title="등록한 문의가 없습니다"
              description="궁금한 점을 남겨 주시면 확인 후 답변해 드립니다."
            />
          ) : (
            <VStack gap="x5" alignItems="stretch">
              {groups.map(([date, dateInquiries]) => (
                <VStack key={date} gap="x1" alignItems="stretch">
                  <ListHeader variant="boldSolid">{date}</ListHeader>
                  <Accordion
                    type="multiple"
                    variant="separated"
                    value={openInquiryIds}
                    onValueChange={setOpenInquiryIds}
                  >
                    {dateInquiries.map((inquiry) => (
                      <AccordionItem key={inquiry.id} value={inquiry.id}>
                        <AccordionTrigger>
                          <VStack
                            gap="x2"
                            alignItems="flex-start"
                            width="full"
                            minWidth={0}
                          >
                            <HStack gap="x2" wrap>
                              <Badge tone={inquiryStatusTone(inquiry.status)}>
                                {inquiry.status}
                              </Badge>
                              <Text
                                textStyle="caption"
                                color="fg.neutral-muted"
                              >
                                {inquiry.category}
                              </Text>
                            </HStack>
                            <Text
                              textStyle="label"
                              color="fg.neutral"
                              maxLines={2}
                            >
                              {inquiry.title}
                            </Text>
                          </VStack>
                        </AccordionTrigger>
                        <AccordionContent>
                          <VStack gap="x4" alignItems="stretch">
                            <Article>
                              <Text
                                as="p"
                                textStyle="bodySm"
                                color="fg.neutral-muted"
                                className="whitespace-pre-wrap"
                              >
                                {inquiry.content}
                              </Text>
                            </Article>

                            {inquiry.product_id !== null ? (
                              <InquiryProduct
                                productId={inquiry.product_id}
                                enabled={openInquiryIds.includes(inquiry.id)}
                              />
                            ) : null}

                            {inquiry.answer ? (
                              <Article
                                bg="bg.neutral-weak"
                                borderRadius="r3"
                                p="x4"
                              >
                                <VStack gap="x2" alignItems="stretch">
                                  <Text
                                    as="h4"
                                    textStyle="labelSm"
                                    color="fg.positive"
                                  >
                                    답변 ·{" "}
                                    {formatDate(inquiry.answer_date, true)}
                                  </Text>
                                  <Text
                                    as="p"
                                    textStyle="bodySm"
                                    color="fg.neutral-muted"
                                    className="whitespace-pre-wrap"
                                  >
                                    {inquiry.answer}
                                  </Text>
                                </VStack>
                              </Article>
                            ) : null}

                            {isInquiryEditable(inquiry.status) ? (
                              <HStack gap="x2" wrap>
                                <ActionButton
                                  type="button"
                                  size="small"
                                  variant="neutralOutline"
                                  onClick={() => openEditForm(inquiry)}
                                >
                                  수정
                                </ActionButton>
                                <ActionButton
                                  type="button"
                                  size="small"
                                  variant="ghost"
                                  onClick={() => setDeleteTarget(inquiry)}
                                >
                                  삭제
                                </ActionButton>
                              </HStack>
                            ) : null}
                          </VStack>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </VStack>
              ))}
            </VStack>
          )}
        </VStack>

        <InquiryFormModal
          open={formOpen}
          inquiry={editingInquiry}
          prefill={prefill}
          onOpenChange={changeFormOpen}
        />
        <AlertDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => {
            if (!open && !removeInquiry.isPending) setDeleteTarget(null);
          }}
          title="문의를 삭제할까요?"
          description="삭제한 문의는 복구할 수 없습니다."
          primaryActionProps={{
            children: "삭제",
            variant: "criticalSolid",
            loading: removeInquiry.isPending,
            onClick: (event) => {
              event.preventDefault();
              void confirmDelete();
            },
          }}
          secondaryActionProps={{ children: "취소" }}
        />
      </ContentLayout>
    </>
  );
}

function InquiryProduct({
  productId,
  enabled,
}: {
  productId: number;
  enabled: boolean;
}) {
  const productQuery = useQuery({
    ...getProductOptions({ path: { product_id: productId } }),
    enabled,
  });
  const product = productQuery.data ?? null;
  return (
    <VStack gap="x2" alignItems="stretch">
      <Text textStyle="labelSm">문의 상품</Text>
      {productQuery.isPending ? (
        <Skeleton width="100%" height={72} />
      ) : (
        <Box
          bg="bg.layer-default"
          borderWidth={1}
          borderColor="stroke.neutral-weak"
          borderRadius="r3"
          p="x3"
        >
          <HStack gap="x3">
            <Box position="relative" width={48} height={48} flexShrink>
              <ImageFrame
                fill
                borderRadius="r2"
                src={product?.image}
                alt=""
                loading="lazy"
              />
            </Box>
            <VStack gap="x0_5" minWidth={0}>
              <Text textStyle="labelSm" maxLines={2}>
                {product?.name ?? `상품 #${productId}`}
              </Text>
              {!product ? (
                <Text textStyle="caption" color="fg.neutral-muted">
                  상품 정보를 불러오지 못했습니다.
                </Text>
              ) : null}
            </VStack>
          </HStack>
        </Box>
      )}
    </VStack>
  );
}

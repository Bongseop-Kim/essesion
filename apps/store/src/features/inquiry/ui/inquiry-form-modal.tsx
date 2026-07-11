import type { InquiryOut, ProductOut } from "@essesion/api-client";
import {
  createInquiryMutation,
  getProductOptions,
  listMyInquiriesQueryKey,
  listProductsOptions,
  updateInquiryMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  Badge,
  Box,
  Chip,
  ContentPlaceholder,
  cn,
  Field,
  HStack,
  ImageFrame,
  ResponsiveModal,
  ScrollFog,
  Skeleton,
  snackbar,
  Text,
  TextAreaField,
  TextField,
  useFieldContext,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { useZodForm } from "@/shared/lib/form";
import { INQUIRY_CATEGORIES, type InquiryPrefill } from "../model/config";
import {
  inquiryFormSchema,
  inquiryFormValues,
  inquiryRequestFromForm,
} from "../model/form";

type InquiryFormModalProps = {
  open: boolean;
  inquiry: InquiryOut | null;
  prefill: InquiryPrefill | null;
  onOpenChange: (open: boolean) => void;
};

export function InquiryFormModal({
  open,
  inquiry,
  prefill,
  onOpenChange,
}: InquiryFormModalProps) {
  const queryClient = useQueryClient();
  const createInquiry = useMutation(createInquiryMutation());
  const updateInquiry = useMutation(updateInquiryMutation());
  const form = useZodForm(inquiryFormSchema, {
    defaultValues: inquiryFormValues(null, prefill),
  });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const category = form.watch("category");
  const productId = form.watch("product_id");
  const content = form.watch("content");
  const productsQuery = useQuery({
    ...listProductsOptions({
      query: { q: debouncedSearch.trim(), limit: 20 },
    }),
    enabled: open && category === "상품" && debouncedSearch.trim().length > 0,
  });
  const selectedProductQuery = useQuery({
    ...getProductOptions({ path: { product_id: productId ?? 0 } }),
    enabled: open && category === "상품" && productId !== null,
  });
  const selectedProduct = selectedProductQuery.data ?? null;
  const results = (productsQuery.data ?? []).filter(
    (product) => product.id !== productId,
  );
  const isSaving = createInquiry.isPending || updateInquiry.isPending;

  useEffect(() => {
    if (!open) return;
    form.reset(inquiryFormValues(inquiry, prefill));
    setSearch("");
    setDebouncedSearch("");
  }, [form, inquiry, open, prefill]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const save = form.handleSubmit(async (values) => {
    const body = inquiryRequestFromForm(values);
    try {
      if (inquiry) {
        await updateInquiry.mutateAsync({
          path: { inquiry_id: inquiry.id },
          body,
        });
      } else {
        await createInquiry.mutateAsync({ body });
      }
      await queryClient.invalidateQueries({
        queryKey: listMyInquiriesQueryKey(),
      });
      onOpenChange(false);
      snackbar(inquiry ? "문의를 수정했습니다." : "문의를 등록했습니다.");
    } catch {
      snackbar(
        inquiry
          ? "문의를 수정하지 못했습니다. 다시 시도해 주세요."
          : "문의를 등록하지 못했습니다. 다시 시도해 주세요.",
      );
    }
  });

  const selectProduct = (product: ProductOut) => {
    form.setValue("product_id", product.id, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={inquiry ? "1:1 문의 수정" : "1:1 문의하기"}
      description={
        inquiry
          ? "답변이 등록되기 전까지 문의 내용을 수정할 수 있습니다."
          : "확인이 필요한 내용을 남겨 주시면 답변해 드립니다."
      }
      showCloseButton
      size="medium"
      footer={
        <Box
          as={ActionButton}
          type="button"
          width="full"
          loading={isSaving}
          onClick={() => void save()}
        >
          {inquiry ? "수정" : "등록"}
        </Box>
      }
    >
      <form onSubmit={save}>
        <VStack gap="x5" alignItems="stretch">
          <VStack gap="x2" alignItems="stretch">
            <Text textStyle="labelSm">문의 유형</Text>
            <ScrollFog direction="horizontal">
              <HStack gap="x2">
                {INQUIRY_CATEGORIES.map((option) => (
                  <Chip
                    key={option.value}
                    selected={category === option.value}
                    disabled={isSaving}
                    onClick={() => {
                      form.setValue("category", option.value, {
                        shouldDirty: true,
                      });
                      if (option.value !== "상품") {
                        form.setValue("product_id", null, {
                          shouldDirty: true,
                        });
                        form.clearErrors("product_id");
                      }
                    }}
                  >
                    {option.label}
                  </Chip>
                ))}
              </HStack>
            </ScrollFog>
          </VStack>

          {category === "상품" ? (
            <Field
              label="문의 상품"
              required
              errorMessage={form.formState.errors.product_id?.message}
            >
              <ProductChoiceGroup>
                {selectedProductQuery.isPending && productId !== null ? (
                  <Skeleton width="100%" height={72} />
                ) : selectedProduct ? (
                  <ProductChoice product={selectedProduct} selected />
                ) : productId !== null && selectedProductQuery.isError ? (
                  <ContentPlaceholder
                    title={`선택한 상품 #${productId}을 불러오지 못했습니다`}
                    description="다시 시도하거나 다른 상품을 검색해 주세요."
                    action={
                      <ActionButton
                        type="button"
                        variant="neutralOutline"
                        onClick={() => void selectedProductQuery.refetch()}
                      >
                        다시 시도
                      </ActionButton>
                    }
                  />
                ) : productId !== null && selectedProductQuery.isSuccess ? (
                  <Text textStyle="caption" color="fg.critical">
                    선택한 상품을 찾을 수 없습니다. 다른 상품을 검색해 주세요.
                  </Text>
                ) : null}

                <TextField
                  label="상품 검색"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="상품명을 입력해 주세요."
                  autoComplete="off"
                  disabled={isSaving}
                />

                {productsQuery.isPending && debouncedSearch.trim() ? (
                  <VStack gap="x2" alignItems="stretch">
                    <Skeleton width="100%" height={72} />
                    <Skeleton width="100%" height={72} />
                  </VStack>
                ) : productsQuery.isError ? (
                  <ContentPlaceholder
                    title="상품을 불러오지 못했습니다"
                    description="잠시 후 다시 시도해 주세요."
                    action={
                      <ActionButton
                        type="button"
                        variant="neutralOutline"
                        onClick={() => void productsQuery.refetch()}
                      >
                        다시 시도
                      </ActionButton>
                    }
                  />
                ) : !debouncedSearch.trim() ? (
                  <Text textStyle="caption" color="fg.neutral-muted">
                    {selectedProduct
                      ? "다른 상품으로 바꾸려면 상품명을 검색해 주세요."
                      : "상품명을 검색한 뒤 문의할 상품을 선택해 주세요."}
                  </Text>
                ) : results.length === 0 ? (
                  <ContentPlaceholder
                    title="검색 결과가 없습니다"
                    description="다른 상품명으로 검색해 주세요."
                  />
                ) : (
                  <VStack gap="x2" alignItems="stretch">
                    {results.map((product) => (
                      <ProductChoice
                        key={product.id}
                        product={product}
                        onSelect={() => selectProduct(product)}
                      />
                    ))}
                  </VStack>
                )}
              </ProductChoiceGroup>
            </Field>
          ) : null}

          <TextField
            label="제목"
            maxLength={200}
            placeholder="문의 제목을 입력해 주세요."
            errorMessage={form.formState.errors.title?.message}
            disabled={isSaving}
            {...form.register("title")}
          />
          <TextAreaField
            label="문의 내용"
            description={`${content.length}/5,000자`}
            maxLength={5000}
            rows={7}
            autoResize
            placeholder="문의 내용을 자세히 입력해 주세요."
            errorMessage={form.formState.errors.content?.message}
            disabled={isSaving}
            {...form.register("content")}
          />
        </VStack>
      </form>
    </ResponsiveModal>
  );
}

function ProductChoiceGroup({ children }: { children: ReactNode }) {
  const field = useFieldContext();
  return (
    <VStack
      id={field?.controlId}
      role="group"
      aria-label="문의 상품"
      aria-describedby={field?.describedBy}
      aria-invalid={field?.invalid || undefined}
      gap="x3"
      alignItems="stretch"
    >
      {children}
    </VStack>
  );
}

function ProductChoice({
  product,
  selected = false,
  onSelect,
}: {
  product: ProductOut;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const content = (
    <HStack gap="x3" align="center">
      <Box position="relative" width={48} height={48} flexShrink>
        <ImageFrame
          fill
          borderRadius="r2"
          src={product.image}
          alt=""
          loading="lazy"
        />
      </Box>
      <Text textStyle="labelSm" flex={1} minWidth={0} maxLines={2}>
        {product.name}
      </Text>
      {selected ? <Badge tone="brand">선택됨</Badge> : null}
    </HStack>
  );
  const className = cn(
    "text-left transition-colors duration-100 ease-standard",
    onSelect &&
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring",
    selected
      ? "bg-bg-brand-weak"
      : "bg-bg-layer-default hover:bg-bg-neutral-weak",
  );

  if (!onSelect) {
    return (
      <Box
        width="full"
        p="x3"
        borderWidth={1}
        borderColor={selected ? "stroke.brand" : "stroke.neutral-weak"}
        borderRadius="r3"
        className={className}
      >
        {content}
      </Box>
    );
  }

  return (
    <Box
      as="button"
      type="button"
      aria-pressed={selected}
      width="full"
      p="x3"
      borderWidth={1}
      borderColor={selected ? "stroke.brand" : "stroke.neutral-weak"}
      borderRadius="r3"
      className={className}
      onClick={onSelect}
    >
      {content}
    </Box>
  );
}

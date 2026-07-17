import { createReadUrl } from "@essesion/api-client";
import { getReformPricingOptions } from "@essesion/api-client/query";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  ActionButton,
  AlertDialog,
  Box,
  Callout,
  Checkbox,
  ContentPlaceholder,
  HelpBubbleTrigger,
  HStack,
  Icon,
  Skeleton,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import { InformationCircleIcon } from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FormProvider,
  useFieldArray,
  useForm,
  useWatch,
} from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router";

import { useAuthGuard } from "@/features/auth";
import { useCartActions, useCartItems } from "@/features/cart";
import { InquirySection } from "@/features/inquiry";
import {
  BulkApplyModal,
  calculateReformCost,
  createReformTie,
  mapWithConcurrency,
  type ReformFormValues,
  ReformHeightGuide,
  ReformServiceGuide,
  ReformSettingsModal,
  type ReformSettingsValues,
  type ReformTieForm,
  reformDataFromForm,
  reformFormFromData,
  TieItemForm,
  uploadReformImage,
} from "@/features/reform";
import { ReviewListSection } from "@/features/reviews";
import { PageMeta } from "@/shared/seo/page-meta";
import { ContentLayout } from "@/shared/ui/content-layout";
import { StickySectionNav } from "@/shared/ui/sticky-section-nav";
import { SummaryCard } from "@/shared/ui/summary-card";

const MAX_TIES = 50;

export function ReformPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editItemId = params.get("edit");
  const { requireAuth } = useAuthGuard();
  const cart = useCartItems();
  const cartActions = useCartActions();
  const pricingQuery = useQuery(getReformPricingOptions());
  const form = useForm<ReformFormValues>({
    defaultValues: { ties: [] },
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "ties",
  });
  const ties = useWatch({ control: form.control, name: "ties" }) ?? [];
  const [selectedIds, setSelectedIds] = useState(() => new Set<string>());
  const [settingsTarget, setSettingsTarget] = useState<number | "new" | null>(
    null,
  );
  const [bulkOpen, setBulkOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [addedDialogOpen, setAddedDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const editLoaded = useRef(false);

  useEffect(() => {
    if (!editItemId || editLoaded.current || cart.isPending) return;
    const item = cart.inputs.find(
      (candidate) =>
        candidate.item_id === editItemId && candidate.item_type === "reform",
    );
    if (!item?.reform_data) return;
    editLoaded.current = true;
    const tie = reformFormFromData(item.item_id, item.reform_data);
    form.reset({ ties: [tie] });
    setSelectedIds(new Set([tie.itemId]));
    void createReadUrl({
      body: {
        object_key: item.reform_data.tie.image.object_key,
        claim_token: item.reform_data.tie.image.claim_token,
      },
    }).then(({ data }) => {
      const current = form.getValues("ties.0");
      if (
        data &&
        !current.file &&
        current.uploadedImage?.object_key ===
          item.reform_data?.tie.image.object_key
      ) {
        form.setValue("ties.0.previewUrl", data.read_url);
      }
    });
  }, [cart.inputs, cart.isPending, editItemId, form]);

  useEffect(
    () => () => {
      for (const tie of form.getValues("ties")) {
        if (tie.previewUrl?.startsWith("blob:"))
          URL.revokeObjectURL(tie.previewUrl);
      }
    },
    [form],
  );

  const selectedTies = useMemo(
    () => ties.filter((tie) => selectedIds.has(tie.itemId)),
    [selectedIds, ties],
  );
  const serviceCost = pricingQuery.data
    ? selectedTies.reduce(
        (sum, tie) => sum + calculateReformCost(tie, pricingQuery.data),
        0,
      )
    : 0;
  const shippingCost =
    selectedTies.length > 0 ? (pricingQuery.data?.shipping_cost ?? 0) : 0;
  const totalCost = serviceCost + shippingCost;
  const allSelected = fields.length > 0 && selectedIds.size === fields.length;
  const partiallySelected = selectedIds.size > 0 && !allSelected;

  const toggleSelected = (itemId: string, selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  };

  const addTie = () => {
    if (fields.length >= MAX_TIES) {
      snackbar("한 번에 최대 50개까지 접수할 수 있습니다.");
      return;
    }
    setSettingsTarget("new");
  };

  const settingsInitial = useMemo<ReformSettingsValues>(() => {
    const tie =
      typeof settingsTarget === "number"
        ? form.getValues(`ties.${settingsTarget}`)
        : null;
    return tieSettings(tie ?? createReformTie());
  }, [settingsTarget, form]);

  const applySettings = (index: number, values: ReformSettingsValues) => {
    const next = normalizeSettings(values);
    form.setValue(`ties.${index}.automaticEnabled`, next.automaticEnabled);
    form.setValue(`ties.${index}.mechanism`, next.mechanism);
    form.setValue(`ties.${index}.wearerHeightCm`, next.wearerHeightCm);
    form.setValue(`ties.${index}.dimple`, next.dimple);
    form.setValue(`ties.${index}.turnKnot`, next.turnKnot);
    form.setValue(`ties.${index}.widthEnabled`, next.widthEnabled);
    form.setValue(`ties.${index}.targetWidthCm`, next.targetWidthCm);
    form.setValue(`ties.${index}.restorationEnabled`, next.restorationEnabled);
    form.setValue(`ties.${index}.restorationMemo`, next.restorationMemo);
  };

  const removeTie = (index: number) => {
    const tie = form.getValues(`ties.${index}`);
    if (tie?.previewUrl?.startsWith("blob:"))
      URL.revokeObjectURL(tie.previewUrl);
    remove(index);
    if (tie) {
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(tie.itemId);
        return next;
      });
    }
  };

  const removeSelected = () => {
    const indexes = fields.flatMap((_field, index) =>
      selectedIds.has(form.getValues(`ties.${index}.itemId`)) ? [index] : [],
    );
    for (const index of indexes.slice().reverse()) removeTie(index);
  };

  const applyBulk = (values: ReformSettingsValues) => {
    ties.forEach((tie, index) => {
      if (selectedIds.has(tie.itemId)) applySettings(index, values);
    });
    snackbar(`${selectedIds.size}개 항목에 수선 설정을 적용했습니다.`);
  };

  // 수선 옵션은 추가·수정 모두 ReformSettingsModal에서 검증하므로 여기서는 사진만 확인한다.
  const validateSelected = () => {
    form.clearErrors();
    if (selectedTies.length === 0) {
      snackbar("접수할 넥타이를 선택해 주세요.");
      return false;
    }
    let firstInvalid: number | null = null;
    ties.forEach((tie, index) => {
      if (!selectedIds.has(tie.itemId)) return;
      if (!tie.file && !tie.uploadedImage) {
        form.setError(`ties.${index}.file`, {
          type: "manual",
          message: "넥타이 사진을 선택해 주세요.",
        });
        firstInvalid ??= index;
      }
    });
    if (firstInvalid != null) {
      snackbar("사진을 확인해 주세요.");
      // 첫 에러 항목으로 포커스 이동 — custom-order의 focusInvalid와 같은 지연(스크롤 완료 후 포커스)
      const container = document.getElementById(`reform-tie-${firstInvalid}`);
      container?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => {
        container
          ?.querySelector<HTMLInputElement>('input[type="file"]')
          ?.focus({ preventScroll: true });
      }, 300);
      return false;
    }
    return true;
  };

  const submit = async (directOrder: boolean) => {
    if (submitting || !validateSelected()) return;
    setSubmitting(true);
    try {
      const selected = form
        .getValues("ties")
        .map((tie, index) => ({ tie, index }))
        .filter(({ tie }) => selectedIds.has(tie.itemId));
      const prepared = await mapWithConcurrency(
        selected,
        3,
        async ({ tie, index }) => {
          const uploadedImage =
            tie.uploadedImage ??
            (tie.file ? await uploadReformImage(tie.file) : null);
          if (!uploadedImage) throw new Error("수선 사진이 필요합니다.");
          form.setValue(`ties.${index}.uploadedImage`, uploadedImage);
          return { ...tie, uploadedImage };
        },
      );
      const reforms = prepared.map((tie) => ({
        itemId: tie.itemId,
        reformData: reformDataFromForm(tie),
      }));
      await cartActions.upsertReforms(reforms);
      const cartItemIds = reforms.map((reform) => reform.itemId);

      if (directOrder) {
        if (
          requireAuth({
            path: "/order/order-form",
            state: { cartItemIds },
          })
        ) {
          navigate("/order/order-form", { state: { cartItemIds } });
        }
        return;
      }

      for (const tie of form.getValues("ties")) {
        if (tie.previewUrl?.startsWith("blob:"))
          URL.revokeObjectURL(tie.previewUrl);
      }
      form.reset({ ties: [] });
      setSelectedIds(new Set());
      setAddedDialogOpen(true);
    } catch (error) {
      snackbar(
        error instanceof Error
          ? error.message
          : "수선 항목을 저장하지 못했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (pricingQuery.isPending) return <ReformSkeleton />;
  if (pricingQuery.isError || !pricingQuery.data) {
    return (
      <ContentLayout breadcrumbs={reformCrumbs()}>
        <ContentPlaceholder
          title="수선 비용을 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
          action={
            <ActionButton
              variant="neutralOutline"
              onClick={() => void pricingQuery.refetch()}
            >
              다시 시도
            </ActionButton>
          }
        />
      </ContentLayout>
    );
  }

  return (
    <FormProvider {...form}>
      <PageMeta
        title="넥타이 수선·리폼 | 영선산업"
        description="폭 조절, 길이 수선, 리폼까지 — 소중한 넥타이를 새것처럼 되살려 드립니다."
        path="/reform"
      />
      <ContentLayout
        breadcrumbs={reformCrumbs()}
        sidebar={
          <SummaryCard.Root>
            <SummaryCard.Section
              title="결제 예상 금액"
              description="선택한 넥타이 기준이며 주문서에서 최종 확인합니다."
            />
            <SummaryCard.Row
              label="선택 항목"
              value={`${selectedTies.length}개`}
            />
            <SummaryCard.Row
              label="수선 금액"
              value={`${serviceCost.toLocaleString()}원`}
            />
            <SummaryCard.Row
              label="배송비"
              value={`${shippingCost.toLocaleString()}원`}
            />
            <SummaryCard.Total
              label="예상 결제 금액"
              value={`${totalCost.toLocaleString()}원`}
            />
            <Callout
              title="발송 안내"
              description="예상 수선 기간은 영업일 기준 7~14일입니다. 결제 후 직접 발송하거나 주문서에서 방문 수거를 신청할 수 있습니다."
            />
            <Accordion type="single">
              <AccordionItem value="length-guide">
                <AccordionTrigger>내게 맞는 넥타이 길이</AccordionTrigger>
                <AccordionContent>
                  <ReformHeightGuide compact />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </SummaryCard.Root>
        }
        actionBar={
          <HStack gap="x2">
            <Box
              as={ActionButton}
              type="button"
              variant="neutralOutline"
              size="large"
              width="full"
              disabled={selectedIds.size === 0}
              loading={submitting}
              onClick={() => void submit(false)}
            >
              장바구니 담기
            </Box>
            <Box
              as={ActionButton}
              type="button"
              size="large"
              width="full"
              disabled={selectedIds.size === 0}
              loading={submitting}
              onClick={() => void submit(true)}
            >
              바로주문
            </Box>
          </HStack>
        }
        detail={
          <StickySectionNav
            aria-label="수선 서비스 상세 메뉴"
            sections={[
              {
                id: "reform-info",
                label: "정보",
                content: <ReformServiceGuide />,
              },
              {
                id: "reform-inquiry",
                label: "문의",
                content: <InquirySection category="수선" />,
              },
              {
                id: "reform-reviews",
                label: "후기",
                content: <ReviewListSection orderType="repair" />,
              },
            ]}
          />
        }
      >
        <VStack gap="x5" alignItems="stretch">
          <VStack gap="x2">
            <HStack gap={0} align="center">
              <Text as="h1" textStyle="title1">
                넥타이 수선·리폼
              </Text>
              <HelpBubbleTrigger
                title="입력 전 확인"
                description={
                  "넥타이 전체가 보이는 사진을 1장 선택해 주세요.\n\n자동 수선은 지퍼 또는 끈 중 하나를 선택합니다. 끈 방식에서는 돌려묶기를 제공하지 않습니다."
                }
                placement="bottom"
                contentProps={{
                  style: { maxWidth: "min(300px, calc(100vw - 32px))" },
                }}
              >
                <ActionButton
                  variant="ghost"
                  size="xsmall"
                  iconOnly
                  aria-label="입력 도움말"
                >
                  <Icon svg={<InformationCircleIcon />} size={18} />
                </ActionButton>
              </HelpBubbleTrigger>
            </HStack>
            <Text textStyle="body" color="fg.neutral-muted">
              넥타이마다 사진과 원하는 수선 내용을 입력해 주세요.
            </Text>
          </VStack>

          <HStack justify="space-between" gap="x3" wrap>
            <Checkbox
              label={`전체 선택 (${selectedIds.size}/${fields.length})`}
              checked={allSelected}
              indeterminate={partiallySelected}
              onChange={(event) =>
                setSelectedIds(
                  event.currentTarget.checked
                    ? new Set(form.getValues("ties").map((tie) => tie.itemId))
                    : new Set(),
                )
              }
            />
            <HStack gap="x2">
              <ActionButton
                variant="neutralOutline"
                size="small"
                disabled={selectedIds.size === 0}
                onClick={() => setBulkOpen(true)}
              >
                일괄 적용
              </ActionButton>
              <ActionButton
                variant="ghost"
                size="small"
                disabled={selectedIds.size === 0}
                onClick={() => setDeleteOpen(true)}
              >
                선택 삭제
              </ActionButton>
            </HStack>
          </HStack>

          {fields.length === 0 ? (
            <ContentPlaceholder
              title="수선할 넥타이가 없습니다"
              description="새 항목을 추가해 주세요."
            />
          ) : (
            <VStack gap="x3" alignItems="stretch">
              {fields.map((field, index) => {
                const tie = ties[index];
                return (
                  <TieItemForm
                    key={field.id}
                    index={index}
                    selected={!!tie && selectedIds.has(tie.itemId)}
                    cost={tie ? calculateReformCost(tie, pricingQuery.data) : 0}
                    onSelectedChange={(selected) =>
                      tie && toggleSelected(tie.itemId, selected)
                    }
                    onEditOptions={() => setSettingsTarget(index)}
                    onRemove={() => removeTie(index)}
                  />
                );
              })}
            </VStack>
          )}

          <Box alignSelf="flex-end">
            <ActionButton
              variant="neutralOutline"
              disabled={fields.length >= MAX_TIES}
              onClick={addTie}
            >
              넥타이 추가
            </ActionButton>
          </Box>
        </VStack>
      </ContentLayout>

      <ReformSettingsModal
        open={settingsTarget != null}
        title={settingsTarget === "new" ? "넥타이 추가" : "수선 옵션 변경"}
        description={
          settingsTarget === "new"
            ? "수선 옵션을 입력하면 목록에 추가됩니다. 사진은 추가된 항목에서 등록해 주세요."
            : undefined
        }
        submitLabel={settingsTarget === "new" ? "추가" : "변경"}
        initialValues={settingsInitial}
        onOpenChange={(open) => {
          if (!open) setSettingsTarget(null);
        }}
        onApply={(values) => {
          if (settingsTarget === "new") {
            const tie = { ...createReformTie(), ...normalizeSettings(values) };
            append(tie);
            setSelectedIds((current) => new Set(current).add(tie.itemId));
          } else if (typeof settingsTarget === "number") {
            applySettings(settingsTarget, values);
          }
        }}
      />
      <BulkApplyModal
        open={bulkOpen}
        selectedCount={selectedIds.size}
        onOpenChange={setBulkOpen}
        onApply={applyBulk}
      />
      <AlertDialog
        open={addedDialogOpen}
        onOpenChange={setAddedDialogOpen}
        title="장바구니에 담았습니다"
        description="계속 쇼핑하거나 장바구니로 이동할 수 있습니다."
        primaryActionProps={{
          children: "장바구니로 이동",
          onClick: () => navigate("/cart"),
        }}
        secondaryActionProps={{
          children: "계속 쇼핑",
          variant: "neutralOutline",
        }}
      />
      <AlertDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="선택 항목 삭제"
        description={`선택한 ${selectedIds.size}개 넥타이를 삭제할까요?`}
        primaryActionProps={{
          children: "삭제",
          variant: "criticalSolid",
          onClick: removeSelected,
        }}
        secondaryActionProps={{ children: "취소" }}
      />
    </FormProvider>
  );
}

function ReformSkeleton() {
  return (
    <ContentLayout breadcrumbs={reformCrumbs()}>
      <VStack gap="x4" alignItems="stretch">
        <Skeleton width="40%" height={36} />
        <Skeleton width="100%" height={360} />
      </VStack>
    </ContentLayout>
  );
}

function reformCrumbs() {
  return [{ label: "홈", href: "/" }, { label: "넥타이 수선·리폼" }];
}

function tieSettings(tie: ReformTieForm): ReformSettingsValues {
  return {
    automaticEnabled: tie.automaticEnabled,
    mechanism: tie.mechanism,
    wearerHeightCm: tie.wearerHeightCm,
    dimple: tie.dimple,
    turnKnot: tie.turnKnot,
    widthEnabled: tie.widthEnabled,
    targetWidthCm: tie.targetWidthCm,
    restorationEnabled: tie.restorationEnabled,
    restorationMemo: tie.restorationMemo,
  };
}

/** 비활성 서비스의 잔여 입력값을 비워 저장 데이터를 깨끗하게 유지한다. */
function normalizeSettings(values: ReformSettingsValues): ReformSettingsValues {
  return {
    automaticEnabled: values.automaticEnabled,
    mechanism: values.automaticEnabled ? values.mechanism : "",
    wearerHeightCm: values.automaticEnabled ? values.wearerHeightCm : null,
    dimple: values.automaticEnabled && values.dimple,
    turnKnot:
      values.automaticEnabled &&
      values.mechanism === "zipper" &&
      values.turnKnot,
    widthEnabled: values.widthEnabled,
    targetWidthCm: values.widthEnabled ? values.targetWidthCm : null,
    restorationEnabled: values.restorationEnabled,
    restorationMemo: values.restorationEnabled ? values.restorationMemo : "",
  };
}

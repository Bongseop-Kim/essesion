import {
  createDesignOrderReference,
  type GenerationJobOut,
  type ShippingAddressOut,
} from "@essesion/api-client";
import {
  createQuoteMutation,
  listAddressesOptions,
  listMyQuotesQueryKey,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  AttachmentDisplayField,
  Box,
  Callout,
  Checkbox,
  ContentPlaceholder,
  Divider,
  Grid,
  HelpBubbleTrigger,
  HStack,
  Icon,
  RadioGroup,
  RadioGroupItem,
  SegmentedControl,
  SegmentedControlItem,
  SelectBox,
  SelectBoxItem,
  Skeleton,
  snackbar,
  Text,
  TextAreaField,
  TextField,
  VStack,
} from "@essesion/shared";
import { InformationCircleIcon } from "@heroicons/react/24/outline";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { useAuthGuard } from "@/features/auth";
import {
  CUSTOM_IMAGE_ACCEPT,
  type CustomOrderDraft,
  type CustomOrderFieldId,
  type CustomOrderOptions,
  type CustomOrderSectionId,
  type CustomOrderValidationError,
  clearCustomOrderFormDraft,
  customOrderApiOptions,
  customOrderSummary,
  DEFAULT_CUSTOM_ORDER_OPTIONS,
  DEFAULT_QUOTE_CONTACT,
  handoffAnonymousCustomOrderFormDraft,
  invalidCustomOrderSection,
  MAX_CUSTOM_ORDER_QUANTITY,
  parseCustomOrderFormDraft,
  type QuoteContact,
  readCustomOrderFormDraft,
  saveCustomOrderFormDraft,
  uploadOrderImage,
  useCustomQuote,
} from "@/features/custom-order";
import { DesignPicker } from "@/features/design/ui/design-picker";
import { AddressSelectModal, ShippingAddressCard } from "@/features/shipping";
import { krw } from "@/pages/shop/constants";
import { useSession } from "@/shared/store/session";
import { ContentLayout } from "@/shared/ui/content-layout";
import { SummaryCard } from "@/shared/ui/summary-card";

type LoginDraft = Pick<CustomOrderDraft, "options" | "contact">;

const QUANTITY_PRESETS = [4, 8, 12, 20, 50, 100] as const;
const MAX_IMAGES = 5;
const DESCRIPTION =
  "수량, 원단, 봉제 방식과 마감 사양을 선택하고 맞춤 넥타이 제작 비용을 확인하세요.";

export function CustomOrderPage() {
  const status = useSession((state) => state.status);
  const user = useSession((state) => state.user);
  const draftOwnerId =
    status === "authenticated"
      ? user?.id
      : status === "anonymous"
        ? null
        : undefined;
  const ownerKey =
    draftOwnerId === undefined ? "loading" : (draftOwnerId ?? "anonymous");

  return <CustomOrderPageContent key={ownerKey} draftOwnerId={draftOwnerId} />;
}

function CustomOrderPageContent({
  draftOwnerId,
}: {
  draftOwnerId: string | null | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const location = useLocation();
  const { requireAuth } = useAuthGuard();
  const status = useSession((state) => state.status);
  const user = useSession((state) =>
    state.status === "authenticated" ? state.user : null,
  );
  const loginDraft = useMemo(
    () => readLoginDraft(location.state),
    [location.state],
  );
  const restored = useMemo(
    () =>
      loginDraft ??
      (draftOwnerId === undefined
        ? null
        : readCustomOrderFormDraft(draftOwnerId)),
    [draftOwnerId, loginDraft],
  );
  const initialDesigns = useMemo(
    () => readDesignJobs(location.state),
    [location.state],
  );
  const [options, setOptions] = useState<CustomOrderOptions>(
    restored?.options ?? DEFAULT_CUSTOM_ORDER_OPTIONS,
  );
  const [contact, setContact] = useState<QuoteContact>(
    restored?.contact ?? DEFAULT_QUOTE_CONTACT,
  );
  const [files, setFiles] = useState<File[]>([]);
  const [selectedDesigns, setSelectedDesigns] =
    useState<GenerationJobOut[]>(initialDesigns);
  const [address, setAddress] = useState<ShippingAddressOut | null>(null);
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [quoteConfirmOpen, setQuoteConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] =
    useState<CustomOrderValidationError | null>(null);
  const createQuote = useMutation(createQuoteMutation());
  const quantityRef = useRef<HTMLInputElement>(null);
  const tieWidthRef = useRef<HTMLInputElement>(null);
  const dimpleRef = useRef<HTMLInputElement>(null);
  const turnKnotRef = useRef<HTMLInputElement>(null);
  const contactNameRef = useRef<HTMLInputElement>(null);
  const contactValueRef = useRef<HTMLInputElement>(null);
  const profileDefaultsApplied = useRef(false);
  const wasQuoteMode = useRef(options.quantity >= 100);
  const previewUrls = useMemo(
    () => files.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [files],
  );
  const attachmentItems = useMemo(
    () => [
      ...selectedDesigns.map((job, index) => ({
        id: `design:${job.id}`,
        src: job.result_url ?? "",
        alt: `AI 완성 디자인 ${index + 1}`,
      })),
      ...previewUrls.map(({ file, url }) => ({
        id: `file:${file.name}-${file.size}-${file.lastModified}`,
        src: url,
        alt: file.name,
      })),
    ],
    [previewUrls, selectedDesigns],
  );
  const isQuoteMode = options.quantity >= 100;
  const addressesQuery = useQuery({
    ...listAddressesOptions(),
    enabled: status === "authenticated" && isQuoteMode,
  });
  const apiOptions = useMemo(() => customOrderApiOptions(options), [options]);
  const quotePayload = useMemo(
    () => ({ options: apiOptions, quantity: options.quantity }),
    [apiOptions, options.quantity],
  );
  const calculation = useCustomQuote(quotePayload);
  const amount = calculation.data ?? null;

  useEffect(
    () => () => {
      for (const preview of previewUrls) URL.revokeObjectURL(preview.url);
    },
    [previewUrls],
  );

  useEffect(() => {
    if (!address && addressesQuery.data?.[0])
      setAddress(addressesQuery.data[0]);
  }, [address, addressesQuery.data]);

  useEffect(() => {
    if (!loginDraft || !draftOwnerId) return;
    handoffAnonymousCustomOrderFormDraft(draftOwnerId, loginDraft);
    navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: withoutLoginDraft(location.state),
    });
  }, [
    draftOwnerId,
    location.pathname,
    location.search,
    location.state,
    loginDraft,
    navigate,
  ]);

  useEffect(() => {
    if (draftOwnerId === undefined) return;
    const timeout = window.setTimeout(
      () => saveCustomOrderFormDraft(draftOwnerId, { options, contact }),
      400,
    );
    return () => window.clearTimeout(timeout);
  }, [contact, draftOwnerId, options]);

  useEffect(() => {
    if (!user || profileDefaultsApplied.current) return;
    profileDefaultsApplied.current = true;
    setContact((current) => {
      const contactMethod = current.contactValue
        ? current.contactMethod
        : user.phone
          ? "phone"
          : "email";
      return {
        ...current,
        contactName: current.contactName || user.name,
        contactMethod,
        contactValue: current.contactValue || user.phone || user.email || "",
      };
    });
  }, [user]);

  useEffect(() => {
    if (!wasQuoteMode.current && isQuoteMode) {
      snackbar("100개 이상은 견적 요청으로 접수됩니다.");
    }
    wasQuoteMode.current = isQuoteMode;
  }, [isQuoteMode]);

  const update = <K extends keyof CustomOrderOptions>(
    key: K,
    value: CustomOrderOptions[K],
  ) => {
    setValidationError(null);
    setOptions((current) => ({ ...current, [key]: value }));
  };
  const updateContact = <K extends keyof QuoteContact>(
    key: K,
    value: QuoteContact[K],
  ) => {
    setValidationError(null);
    setContact((current) => ({ ...current, [key]: value }));
  };

  const focusInvalid = (error: CustomOrderValidationError) => {
    focusSection(error.section);
    const refs: Partial<Record<CustomOrderFieldId, HTMLInputElement | null>> = {
      quantity: quantityRef.current,
      tieWidth: tieWidthRef.current,
      dimple: dimpleRef.current,
      turnKnot: turnKnotRef.current,
      contactName: contactNameRef.current,
      contactValue: contactValueRef.current,
    };
    window.setTimeout(() => refs[error.field]?.focus(), 300);
  };

  const validate = () => {
    const invalid = invalidCustomOrderSection(options, contact, isQuoteMode);
    if (invalid) {
      setValidationError(invalid);
      focusInvalid(invalid);
      snackbar(invalid.message);
      return false;
    }
    if (!amount || !calculation.isCurrent) {
      snackbar("예상 금액을 확인하는 중입니다.");
      return false;
    }
    return true;
  };

  const requestSubmit = () => {
    if (!validate()) return;
    if (
      !requireAuth({
        path: "/custom-order",
        state: { customOrderDraft: { options, contact } satisfies LoginDraft },
      })
    ) {
      if (files.length > 0 || selectedDesigns.length > 0)
        snackbar("로그인 후 참고 이미지를 다시 첨부해 주세요.");
      return;
    }
    if (isQuoteMode && !address) {
      snackbar("견적을 받을 배송지를 선택해 주세요.");
      return;
    }
    if (isQuoteMode) setQuoteConfirmOpen(true);
    else void submitOrderDraft();
  };

  const uploadOrderImages = async () => {
    const [uploads, imported] = await Promise.all([
      Promise.all(files.map((file) => uploadOrderImage(file, "custom_order"))),
      Promise.all(
        selectedDesigns.map(async (job) => {
          const response = await createDesignOrderReference({
            path: { job_id: job.id },
            query: { kind: "custom_order" },
            throwOnError: true,
          });
          if (!response.data.upload_id)
            throw new Error("완성 디자인의 주문 업로드를 확인하지 못했습니다.");
          return { upload_id: response.data.upload_id };
        }),
      ),
    ]);
    return [...uploads, ...imported];
  };

  const uploadQuoteImages = async () => {
    const [uploads, imported] = await Promise.all([
      Promise.all(files.map((file) => uploadOrderImage(file, "quote_request"))),
      Promise.all(
        selectedDesigns.map(async (job) => {
          const response = await createDesignOrderReference({
            path: { job_id: job.id },
            query: { kind: "quote_request" },
            throwOnError: true,
          });
          return { object_key: response.data.object_key };
        }),
      ),
    ]);
    return [...uploads, ...imported];
  };

  const submitOrderDraft = async () => {
    if (!amount || !calculation.isCurrent || submitting) return;
    setSubmitting(true);
    try {
      const imageRefs = await uploadOrderImages();
      const draft: CustomOrderDraft = {
        options,
        contact,
        imageRefs,
        totalCost: amount.total_cost,
      };
      navigate("/order/custom-payment", { state: { customOrder: draft } });
    } catch (error) {
      snackbar(
        error instanceof Error
          ? error.message
          : "주문 정보를 준비하지 못했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const submitQuote = async () => {
    if (!address || submitting) return;
    setQuoteConfirmOpen(false);
    setSubmitting(true);
    try {
      const imageRefs = await uploadQuoteImages();
      await createQuote.mutateAsync({
        body: {
          shipping_address_id: address.id,
          options: apiOptions,
          quantity: options.quantity,
          contact_name: contact.contactName.trim(),
          business_name: contact.businessName.trim(),
          contact_method: contact.contactMethod,
          contact_value: contact.contactValue.trim(),
          additional_notes: options.additionalNotes.trim(),
          reference_images: imageRefs,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: listMyQuotesQueryKey(),
        refetchType: "all",
      });
      snackbar("견적 요청이 접수되었습니다.");
      if (draftOwnerId !== undefined) {
        clearCustomOrderFormDraft(draftOwnerId);
      }
      navigate("/my-page/quote-request");
    } catch (error) {
      snackbar(
        error instanceof Error
          ? error.message
          : "견적 요청을 접수하지 못했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const summary = customOrderSummary(options);
  const totalCost = amount?.total_cost ?? 0;

  return (
    <>
      <title>맞춤 넥타이 제작 주문 | 영선산업</title>
      <meta name="description" content={DESCRIPTION} />
      <meta property="og:title" content="맞춤 넥타이 제작 주문 | 영선산업" />
      <meta property="og:description" content={DESCRIPTION} />
      <meta property="og:type" content="website" />
      <meta property="og:url" content="https://essesion.shop/custom-order" />
      <link rel="canonical" href="https://essesion.shop/custom-order" />
      <ContentLayout
        breadcrumbs={[{ label: "홈", href: "/" }, { label: "주문 제작" }]}
        sidebar={
          <SummaryCard.Root>
            <SummaryCard.Section
              title={isQuoteMode ? "견적 요약" : "주문 요약"}
              description="선택한 사양을 기준으로 서버가 계산한 예상 금액입니다."
            />
            <Divider />
            {summary.map((row) => (
              <SummaryCard.Row
                key={row.label}
                label={row.label}
                value={row.value}
              />
            ))}
            <SummaryCard.Row
              label="봉제 비용"
              value={amount ? `${krw.format(amount.sewing_cost)}원` : "계산 중"}
            />
            <SummaryCard.Row
              label="원단 비용"
              value={amount ? `${krw.format(amount.fabric_cost)}원` : "계산 중"}
            />
            <SummaryCard.Total
              label={isQuoteMode ? "예상 견적" : "결제 예상 금액"}
              value={amount ? `${krw.format(totalCost)}원` : "-"}
            />
            <Callout
              title={isQuoteMode ? "견적 요청 안내" : "주문 전 확인해 주세요"}
              description={
                isQuoteMode
                  ? "100개 이상은 담당자가 사양을 확인한 뒤 최종 견적을 안내합니다."
                  : `예상 제작 기간은 ${productionPeriod(options)}입니다. 제주·도서산간은 추가 배송비가 발생할 수 있으며, 제작 접수 후에는 취소·환불이 어렵습니다.`
              }
            />
            {calculation.isError ? (
              <Callout
                tone="critical"
                title="예상 금액을 계산하지 못했습니다"
                description="잠시 후 다시 시도해 주세요."
                onClick={() => void calculation.refetch()}
              />
            ) : null}
          </SummaryCard.Root>
        }
        actionBar={
          <VStack gap="x2" alignItems="stretch">
            <Box
              as={ActionButton}
              type="button"
              size="large"
              width="full"
              loading={submitting}
              disabled={!amount || !calculation.isCurrent}
              onClick={requestSubmit}
            >
              {isQuoteMode
                ? "견적 요청하기"
                : `${krw.format(totalCost)}원 주문하기`}
            </Box>
            {isQuoteMode ? (
              <Text textStyle="caption" color="fg.neutral-muted" align="center">
                배송지와 연락처 확인 후 접수됩니다.
              </Text>
            ) : null}
          </VStack>
        }
      >
        <VStack gap="x8" alignItems="stretch">
          <VStack gap="x2">
            <Text as="h1" textStyle="title1">
              맞춤 넥타이 제작
            </Text>
            <Text textStyle="body" color="fg.neutral-muted">
              수량부터 마감까지 원하는 사양을 순서대로 선택해 주세요.
            </Text>
          </VStack>

          <OrderSection id="quantity" title="1. 주문 조건">
            <VStack gap="x4" alignItems="stretch">
              <VStack gap="x2" alignItems="stretch">
                <Text textStyle="labelSm">주문 방식</Text>
                <HStack gap="x4" wrap role="group" aria-label="주문 방식">
                  <Checkbox
                    label="원단 직접 제공"
                    checked={options.fabricProvided}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setValidationError(null);
                      setOptions((current) => ({
                        ...current,
                        fabricProvided: checked,
                        reorder: checked ? false : current.reorder,
                        fabricType: checked ? "POLY" : current.fabricType,
                        designType: checked ? "PRINTING" : current.designType,
                      }));
                    }}
                  />
                  <Checkbox
                    label="재주문"
                    checked={options.reorder}
                    disabled={options.fabricProvided}
                    onChange={(event) =>
                      update("reorder", event.currentTarget.checked)
                    }
                  />
                </HStack>
              </VStack>
              <VStack gap="x2" alignItems="stretch">
                <HStack gap={0} align="center">
                  <Text textStyle="labelSm">제작 수량</Text>
                  <HelpBubbleTrigger
                    title="제작 수량 안내"
                    description="최소 4개부터 주문할 수 있으며 100개 이상은 견적 요청으로 전환됩니다."
                    placement="bottom"
                    contentProps={{
                      style: { maxWidth: "min(300px, calc(100vw - 32px))" },
                    }}
                  >
                    <ActionButton
                      variant="ghost"
                      size="xsmall"
                      iconOnly
                      aria-label="제작 수량 도움말"
                    >
                      <Icon svg={<InformationCircleIcon />} size={18} />
                    </ActionButton>
                  </HelpBubbleTrigger>
                </HStack>
                <HStack
                  gap="x2"
                  wrap
                  role="group"
                  aria-label="제작 수량 빠른 선택"
                >
                  {QUANTITY_PRESETS.map((quantity) => (
                    <ActionButton
                      key={quantity}
                      type="button"
                      size="small"
                      variant={
                        options.quantity === quantity
                          ? "brandSolid"
                          : "neutralOutline"
                      }
                      onClick={() => update("quantity", quantity)}
                    >
                      {quantity}개
                    </ActionButton>
                  ))}
                </HStack>
                <TextField
                  ref={quantityRef}
                  label="수량 직접 입력"
                  type="number"
                  min={4}
                  max={MAX_CUSTOM_ORDER_QUANTITY}
                  step={1}
                  value={options.quantity}
                  errorMessage={
                    validationError?.field === "quantity"
                      ? validationError.message
                      : undefined
                  }
                  onChange={(event) =>
                    update("quantity", Number(event.currentTarget.value))
                  }
                  onBlur={() =>
                    update(
                      "quantity",
                      Math.min(
                        MAX_CUSTOM_ORDER_QUANTITY,
                        Math.max(4, Math.round(options.quantity || 4)),
                      ),
                    )
                  }
                />
              </VStack>
              {isQuoteMode ? (
                <VStack gap="x2" alignItems="stretch">
                  <Text textStyle="labelSm">견적 연락처</Text>
                  <Grid columns={{ base: 1, md: 2 }} gap="x4">
                    <TextField
                      ref={contactNameRef}
                      label="담당자 성함"
                      required
                      value={contact.contactName}
                      errorMessage={
                        validationError?.field === "contactName"
                          ? validationError.message
                          : undefined
                      }
                      onChange={(event) =>
                        updateContact("contactName", event.currentTarget.value)
                      }
                    />
                    <TextField
                      label="상호명"
                      value={contact.businessName}
                      onChange={(event) =>
                        updateContact("businessName", event.currentTarget.value)
                      }
                    />
                    <VStack gap="x2" alignItems="stretch">
                      <Text textStyle="labelSm">연락 방법</Text>
                      <SegmentedControl
                        value={contact.contactMethod}
                        onValueChange={(value) =>
                          updateContact(
                            "contactMethod",
                            value as QuoteContact["contactMethod"],
                          )
                        }
                        aria-label="연락 방법"
                      >
                        <SegmentedControlItem value="phone">
                          전화
                        </SegmentedControlItem>
                        <SegmentedControlItem value="email">
                          이메일
                        </SegmentedControlItem>
                      </SegmentedControl>
                    </VStack>
                    <TextField
                      ref={contactValueRef}
                      label={
                        contact.contactMethod === "email"
                          ? "이메일 주소"
                          : "연락처"
                      }
                      required
                      value={contact.contactValue}
                      errorMessage={
                        validationError?.field === "contactValue"
                          ? validationError.message
                          : undefined
                      }
                      onChange={(event) =>
                        updateContact("contactValue", event.currentTarget.value)
                      }
                    />
                  </Grid>
                </VStack>
              ) : null}
            </VStack>
          </OrderSection>

          {!options.fabricProvided ? (
            <OrderSection id="fabric" title="2. 원단 조합">
              <VStack gap="x3" alignItems="stretch">
                {options.reorder ? (
                  <Callout
                    title="재주문 원단 선택"
                    description="기존 주문과 동일한 원단을 선택해 주세요. 선택한 원단 기준으로 비용이 계산됩니다."
                  />
                ) : null}
                <SelectBox
                  name="custom-order-fabric"
                  value={`${options.fabricType}-${options.designType}`}
                  columns={{ base: 1, sm: 2 }}
                  aria-label="원단 조합"
                  onValueChange={(nextValue) => {
                    const [fabricType, designType] = String(nextValue).split(
                      "-",
                    ) as [
                      CustomOrderOptions["fabricType"],
                      CustomOrderOptions["designType"],
                    ];
                    setValidationError(null);
                    setOptions((current) => ({
                      ...current,
                      fabricType,
                      designType,
                    }));
                  }}
                >
                  <SelectBoxItem
                    value="POLY-PRINTING"
                    label="폴리 · 날염"
                    description="폴리 원단에 디자인을 인쇄하는 방식"
                  />
                  <SelectBoxItem
                    value="POLY-YARN_DYED"
                    label="폴리 · 선염"
                    description="염색한 폴리 실로 무늬를 구성하는 방식"
                  />
                  <SelectBoxItem
                    value="SILK-PRINTING"
                    label="실크 · 날염"
                    description="실크 원단에 디자인을 인쇄하는 방식"
                  />
                  <SelectBoxItem
                    value="SILK-YARN_DYED"
                    label="실크 · 선염"
                    description="염색한 실크 실로 무늬를 구성하는 방식"
                  />
                </SelectBox>
              </VStack>
            </OrderSection>
          ) : null}

          <OrderSection id="sewing" title="3. 봉제">
            <VStack gap="x4" alignItems="stretch">
              <VStack gap="x2" alignItems="stretch">
                <Text textStyle="labelSm">타이 종류</Text>
                <SelectBox
                  name="custom-order-tie-type"
                  value={options.tieType}
                  columns={{ base: 1, sm: 2 }}
                  aria-label="타이 종류"
                  onValueChange={(nextValue) => {
                    const value = String(nextValue);
                    if (
                      value !== "AUTO" &&
                      (options.dimple || options.turnKnot)
                    ) {
                      snackbar(
                        "수동 타이에서는 자동 타이 전용 옵션이 해제됩니다.",
                      );
                    }
                    setValidationError(null);
                    setOptions((current) => ({
                      ...current,
                      tieType: value as CustomOrderOptions["tieType"],
                      dimple: value === "AUTO" ? current.dimple : false,
                      turnKnot: value === "AUTO" ? current.turnKnot : false,
                    }));
                  }}
                >
                  <SelectBoxItem
                    value="MANUAL"
                    label="수동 타이"
                    description="기본 봉제 방식"
                  />
                  <SelectBoxItem
                    value="AUTO"
                    label="자동 타이"
                    description="딤플과 돌려묶기를 선택할 수 있는 봉제 방식"
                  />
                </SelectBox>
              </VStack>
              <VStack gap="x2" alignItems="stretch">
                <Text textStyle="labelSm">봉제 옵션</Text>
                <HStack gap="x4" wrap role="group" aria-label="봉제 옵션">
                  <Checkbox
                    ref={dimpleRef}
                    label="딤플"
                    checked={options.dimple}
                    aria-invalid={
                      validationError?.field === "dimple" || undefined
                    }
                    disabled={options.tieType !== "AUTO"}
                    onChange={(event) =>
                      update("dimple", event.currentTarget.checked)
                    }
                  />
                  <Checkbox
                    ref={turnKnotRef}
                    label="돌려묶기"
                    checked={options.turnKnot}
                    aria-invalid={
                      validationError?.field === "turnKnot" || undefined
                    }
                    disabled={options.tieType !== "AUTO"}
                    onChange={(event) =>
                      update("turnKnot", event.currentTarget.checked)
                    }
                  />
                  <Checkbox
                    label="스포데라토"
                    checked={options.spoderato}
                    onChange={(event) =>
                      update("spoderato", event.currentTarget.checked)
                    }
                  />
                  <Checkbox
                    label="7폴드"
                    checked={options.fold7}
                    onChange={(event) =>
                      update("fold7", event.currentTarget.checked)
                    }
                  />
                </HStack>
              </VStack>
            </VStack>
          </OrderSection>

          <OrderSection id="spec" title="4. 사양">
            <Grid columns={{ base: 1, md: 2 }} gap="x4">
              <VStack gap="x2" alignItems="stretch">
                <Text textStyle="labelSm">사이즈</Text>
                <RadioGroup
                  name="custom-order-size"
                  value={options.sizeType}
                  orientation="horizontal"
                  aria-label="사이즈"
                  onValueChange={(value) =>
                    update("sizeType", value as CustomOrderOptions["sizeType"])
                  }
                >
                  <RadioGroupItem value="ADULT" label="성인용" size="large" />
                  <RadioGroupItem value="CHILD" label="아동용" size="large" />
                </RadioGroup>
              </VStack>
              <TextField
                ref={tieWidthRef}
                label="넥타이 폭 (cm)"
                type="number"
                min={6}
                max={12}
                step={0.5}
                value={options.tieWidth}
                placeholder="6~12cm, 0.5cm 단위"
                errorMessage={
                  validationError?.field === "tieWidth"
                    ? validationError.message
                    : undefined
                }
                onChange={(event) =>
                  update(
                    "tieWidth",
                    event.currentTarget.value === ""
                      ? ""
                      : Number(event.currentTarget.value),
                  )
                }
                onBlur={() => {
                  if (options.tieWidth === "") return;
                  update(
                    "tieWidth",
                    Math.min(
                      12,
                      Math.max(6, Math.round(options.tieWidth * 2) / 2),
                    ),
                  );
                }}
              />
            </Grid>
          </OrderSection>

          <OrderSection id="finishing" title="5. 마감">
            <VStack gap="x4" alignItems="stretch">
              <VStack gap="x2" alignItems="stretch">
                <Text textStyle="labelSm">심지</Text>
                <SelectBox
                  name="custom-order-interlining"
                  value={options.interlining}
                  columns={{ base: 1, sm: 2 }}
                  aria-label="심지"
                  onValueChange={(value) =>
                    update(
                      "interlining",
                      String(value) as CustomOrderOptions["interlining"],
                    )
                  }
                >
                  <SelectBoxItem
                    value="WOOL"
                    label="울 심지"
                    description="추가 비용이 반영되는 울 소재 심지"
                  />
                  <SelectBoxItem
                    value="POLY"
                    label="폴리 심지"
                    description="기본 폴리 소재 심지"
                  />
                </SelectBox>
              </VStack>
              <VStack gap="x2" alignItems="stretch">
                <Text textStyle="labelSm">마감 옵션</Text>
                <HStack gap="x4" wrap role="group" aria-label="마감 옵션">
                  <Checkbox
                    label="삼각 봉제"
                    checked={options.triangleStitch}
                    onChange={(event) =>
                      update("triangleStitch", event.currentTarget.checked)
                    }
                  />
                  <Checkbox
                    label="옆선 봉제"
                    checked={options.sideStitch}
                    onChange={(event) =>
                      update("sideStitch", event.currentTarget.checked)
                    }
                  />
                  <Checkbox
                    label="바택 처리"
                    checked={options.barTack}
                    onChange={(event) =>
                      update("barTack", event.currentTarget.checked)
                    }
                  />
                  <Checkbox
                    label="브랜드 라벨"
                    checked={options.brandLabel}
                    onChange={(event) =>
                      update("brandLabel", event.currentTarget.checked)
                    }
                  />
                  <Checkbox
                    label="케어 라벨"
                    checked={options.careLabel}
                    onChange={(event) =>
                      update("careLabel", event.currentTarget.checked)
                    }
                  />
                </HStack>
              </VStack>
            </VStack>
          </OrderSection>

          <OrderSection id="attachment" title="6. 추가 정보">
            <VStack gap="x4" alignItems="stretch">
              <AttachmentDisplayField
                label="참고 이미지"
                description="JPG, PNG, WebP · 파일당 10MB 이하"
                pickerSlot={
                  <DesignPicker
                    selected={selectedDesigns}
                    onChange={setSelectedDesigns}
                    max={MAX_IMAGES - files.length}
                    disabled={submitting}
                  />
                }
                items={attachmentItems}
                max={MAX_IMAGES}
                accept={CUSTOM_IMAGE_ACCEPT}
                onAddFiles={(selected) => {
                  if (
                    !requireAuth({
                      path: "/custom-order",
                      state: {
                        customOrderDraft: {
                          options,
                          contact,
                        } satisfies LoginDraft,
                      },
                    })
                  ) {
                    return;
                  }
                  setFiles((current) =>
                    [...current, ...selected].slice(
                      0,
                      MAX_IMAGES - selectedDesigns.length,
                    ),
                  );
                }}
                onRemove={(id) => {
                  if (id.startsWith("design:")) {
                    const jobId = id.slice("design:".length);
                    setSelectedDesigns((current) =>
                      current.filter((job) => job.id !== jobId),
                    );
                    return;
                  }
                  const fileId = id.slice("file:".length);
                  const index = previewUrls.findIndex(
                    ({ file }, candidate) =>
                      `${file.name}-${candidate}` === fileId,
                  );
                  if (index >= 0)
                    setFiles((current) =>
                      current.filter((_, candidate) => candidate !== index),
                    );
                }}
              />
              <TextAreaField
                label="추가 요청사항"
                rows={5}
                maxLength={500}
                value={options.additionalNotes}
                placeholder="제작 시 참고할 내용을 입력해 주세요."
                onChange={(event) =>
                  update("additionalNotes", event.currentTarget.value)
                }
              />
              {isQuoteMode ? (
                addressesQuery.isPending ? (
                  <Skeleton width="100%" height={120} />
                ) : addressesQuery.isError ? (
                  <ContentPlaceholder
                    title="배송지를 불러오지 못했습니다"
                    description="잠시 후 다시 시도해 주세요."
                  />
                ) : (
                  <ShippingAddressCard
                    address={address}
                    onChange={() => setAddressModalOpen(true)}
                  />
                )
              ) : null}
            </VStack>
          </OrderSection>
        </VStack>

        <AddressSelectModal
          open={addressModalOpen}
          selected={address}
          onOpenChange={setAddressModalOpen}
          onSelect={setAddress}
        />
        <AlertDialog
          open={quoteConfirmOpen}
          onOpenChange={setQuoteConfirmOpen}
          title="견적을 요청할까요?"
          description="입력한 사양과 연락처를 담당자가 확인한 뒤 안내해 드립니다."
          primaryActionProps={{
            children: "요청하기",
            onClick: () => void submitQuote(),
          }}
          secondaryActionProps={{ children: "취소", variant: "neutralOutline" }}
        />
      </ContentLayout>
    </>
  );
}

function OrderSection({
  id,
  title,
  children,
}: {
  id: CustomOrderSectionId;
  title: string;
  children: ReactNode;
}) {
  return (
    <Box
      as="section"
      id={`custom-order-${id}`}
      pt="x5"
      className="scroll-mt-24 border-t border-stroke-neutral-weak"
    >
      <VStack gap="x4" alignItems="stretch">
        <Text as="h2" textStyle="title2">
          {title}
        </Text>
        {children}
      </VStack>
    </Box>
  );
}

function focusSection(section: CustomOrderSectionId) {
  document
    .getElementById(`custom-order-${section}`)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function readLoginDraft(state: unknown): LoginDraft | null {
  if (!state || typeof state !== "object" || !("customOrderDraft" in state))
    return null;
  return parseCustomOrderFormDraft(
    (state as { customOrderDraft?: unknown }).customOrderDraft,
  );
}

function withoutLoginDraft(state: unknown): unknown {
  if (!state || typeof state !== "object" || Array.isArray(state)) return state;
  const next = { ...(state as Record<string, unknown>) };
  delete next.customOrderDraft;
  return Object.keys(next).length > 0 ? next : null;
}

function readDesignJobs(state: unknown): GenerationJobOut[] {
  if (!state || typeof state !== "object" || !("designJobs" in state)) {
    return [];
  }
  const jobs = (state as { designJobs?: unknown }).designJobs;
  if (!Array.isArray(jobs)) return [];
  return jobs.filter((job): job is GenerationJobOut => {
    if (!job || typeof job !== "object") return false;
    const value = job as Record<string, unknown>;
    return (
      typeof value.id === "string" &&
      value.kind === "finalize" &&
      value.status === "succeeded" &&
      typeof value.created_at === "string" &&
      (value.result_url === null || typeof value.result_url === "string")
    );
  });
}

function productionPeriod(options: CustomOrderOptions) {
  if (options.fabricProvided) return "영업일 기준 7~14일";
  if (options.reorder) return "영업일 기준 21~28일";
  return "영업일 기준 28~42일";
}

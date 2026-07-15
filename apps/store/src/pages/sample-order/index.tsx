import { calculateSampleOrder } from "@essesion/api-client";
import {
  ActionButton,
  AttachmentDisplayField,
  Box,
  Callout,
  Divider,
  SegmentedControl,
  SegmentedControlItem,
  SelectBox,
  SelectBoxItem,
  snackbar,
  Text,
  TextAreaField,
  VStack,
} from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { useAuthGuard } from "@/features/auth";
import { CUSTOM_IMAGE_ACCEPT, uploadOrderImage } from "@/features/custom-order";
import {
  DEFAULT_SAMPLE_ORDER_OPTIONS,
  type SampleOrderDraft,
  type SampleOrderOptions,
  sampleFabricLabel,
  sampleOrderApiOptions,
  sampleTypeLabel,
} from "@/features/sample-order";
import { krw } from "@/pages/shop/constants";
import { ContentLayout } from "@/shared/ui/content-layout";
import { SummaryCard } from "@/shared/ui/summary-card";

const MAX_IMAGES = 5;

export function SampleOrderPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { requireAuth } = useAuthGuard();
  const restored = readSampleOptions(location.state);
  const [options, setOptions] = useState<SampleOrderOptions>(
    restored ?? DEFAULT_SAMPLE_ORDER_OPTIONS,
  );
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // key와 fn이 같은 옵션을 공유하도록 한 번만 계산한다. fabric/tie/interlining 등
  // 모든 API 옵션이 key에 들어가야 값 변경 시 재계산된다(그렇지 않으면 staleTime 동안 캐시).
  const apiOptions = sampleOrderApiOptions(options);
  const calculation = useQuery({
    queryKey: [
      "sample-order",
      "calculate",
      { sample_type: options.sampleType, options: apiOptions },
    ],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await calculateSampleOrder({
        body: {
          sample_type: options.sampleType,
          options: apiOptions,
        },
        throwOnError: true,
      });
      return data;
    },
  });
  const totalCost = calculation.data?.total_cost ?? null;
  const previews = useMemo(
    () => files.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [files],
  );

  useEffect(
    () => () => {
      for (const preview of previews) URL.revokeObjectURL(preview.url);
    },
    [previews],
  );

  const update = <K extends keyof SampleOrderOptions>(
    key: K,
    value: SampleOrderOptions[K],
  ) => setOptions((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (!totalCost || calculation.isPending || submitting) {
      snackbar("샘플 금액을 확인하는 중입니다.");
      return;
    }
    if (
      !requireAuth({
        path: "/sample-order",
        state: { sampleOrderOptions: options },
      })
    ) {
      if (files.length > 0)
        snackbar("로그인 후 참고 이미지를 다시 첨부해 주세요.");
      return;
    }
    setSubmitting(true);
    try {
      const imageRefs = await Promise.all(
        files.map((file) => uploadOrderImage(file, "sample_order")),
      );
      const draft: SampleOrderDraft = { options, imageRefs, totalCost };
      navigate("/order/sample-payment", { state: { sampleOrder: draft } });
    } catch (error) {
      snackbar(
        error instanceof Error
          ? error.message
          : "샘플 주문을 준비하지 못했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ContentLayout
      breadcrumbs={[{ label: "홈", href: "/" }, { label: "샘플 제작" }]}
      sidebar={
        <SummaryCard.Root>
          <SummaryCard.Section
            title="주문 요약"
            description="선택한 샘플 구성과 서버 계산 금액입니다."
          />
          <Divider />
          <SummaryCard.Row
            label="샘플 유형"
            value={sampleTypeLabel(options.sampleType)}
          />
          <SummaryCard.Row label="구성" value={sampleFabricLabel(options)} />
          <SummaryCard.Row label="예상 제작 기간" value="28~42일" />
          <SummaryCard.Total
            label="결제 예상 금액"
            value={totalCost ? `${krw.format(totalCost)}원` : "계산 중"}
          />
          <Callout
            title="샘플 안내"
            description="대량 제작 전에 원단과 봉제 품질을 확인할 수 있습니다. 제주·도서산간은 추가 배송비가 발생할 수 있으며, 제작 접수 후에는 취소·환불이 불가합니다. 샘플 결제 완료 시 본 주문 할인 쿠폰이 발급됩니다."
          />
        </SummaryCard.Root>
      }
      actionBar={
        <Box
          as={ActionButton}
          type="button"
          size="large"
          width="full"
          disabled={!totalCost || calculation.isPending}
          loading={submitting}
          onClick={() => void submit()}
        >
          {totalCost ? `${krw.format(totalCost)}원 주문하기` : "금액 확인 중"}
        </Box>
      }
    >
      <VStack gap="x8" alignItems="stretch">
        <VStack gap="x2">
          <Text as="h1" textStyle="title1">
            샘플 제작
          </Text>
          <Text textStyle="body" color="fg.neutral-muted">
            대량 주문 전에 원하는 구성으로 샘플을 먼저 확인해 보세요.
          </Text>
        </VStack>

        <SampleSection title="1. 샘플 유형">
          <Choice
            label="샘플 유형"
            value={options.sampleType}
            options={[
              { value: "fabric", label: "원단 샘플" },
              { value: "sewing", label: "봉제 샘플" },
              { value: "fabric_and_sewing", label: "원단 + 봉제" },
            ]}
            onChange={(value) =>
              update("sampleType", value as SampleOrderOptions["sampleType"])
            }
          />
        </SampleSection>

        {options.sampleType !== "sewing" ? (
          <SampleSection title="2. 원단 조합">
            <SelectBox
              name="sample-order-fabric"
              value={`${options.fabricType}-${options.designType}`}
              columns={{ base: 1, sm: 2 }}
              aria-label="원단 조합"
              onValueChange={(value) => {
                const [fabricType, designType] = String(value).split("-") as [
                  SampleOrderOptions["fabricType"],
                  SampleOrderOptions["designType"],
                ];
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
          </SampleSection>
        ) : null}

        <SampleSection title="3. 봉제 사양">
          <VStack gap="x4" alignItems="stretch">
            <SelectBox
              name="sample-order-tie-type"
              value={options.tieType}
              columns={{ base: 1, sm: 2 }}
              aria-label="타이 방식"
              onValueChange={(value) =>
                update(
                  "tieType",
                  String(value) as SampleOrderOptions["tieType"],
                )
              }
            >
              <SelectBoxItem
                value="AUTO"
                label="자동 타이"
                description="매듭이 완성된 상태로 착용하는 방식"
              />
              <SelectBoxItem
                value="MANUAL"
                label="수동 타이"
                description="직접 매듭을 묶어 착용하는 방식"
              />
            </SelectBox>
            <SelectBox
              name="sample-order-interlining"
              value={options.interlining}
              columns={{ base: 1, sm: 2 }}
              aria-label="심지"
              onValueChange={(value) =>
                update(
                  "interlining",
                  String(value) as SampleOrderOptions["interlining"],
                )
              }
            >
              <SelectBoxItem
                value="WOOL"
                label="울 심지"
                description="형태 유지와 복원력이 좋은 울 소재 심지"
              />
              <SelectBoxItem
                value="POLY"
                label="폴리 심지"
                description="가볍고 관리가 쉬운 폴리 소재 심지"
              />
            </SelectBox>
          </VStack>
        </SampleSection>

        <SampleSection title="4. 참고 자료">
          <VStack gap="x4" alignItems="stretch">
            <AttachmentDisplayField
              label="참고 이미지"
              description="JPG, PNG, WebP · 파일당 10MB 이하"
              items={previews.map(({ file, url }, index) => ({
                id: `${file.name}-${index}`,
                src: url,
                alt: file.name,
              }))}
              max={MAX_IMAGES}
              accept={CUSTOM_IMAGE_ACCEPT}
              onAddFiles={(selected) =>
                setFiles((current) =>
                  [...current, ...selected].slice(0, MAX_IMAGES),
                )
              }
              onRemove={(id) => {
                const index = previews.findIndex(
                  ({ file }, candidate) => `${file.name}-${candidate}` === id,
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
              onChange={(event) =>
                update("additionalNotes", event.currentTarget.value)
              }
            />
          </VStack>
        </SampleSection>
      </VStack>
    </ContentLayout>
  );
}

function SampleSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Box as="section" pt="x5" className="border-t border-stroke-neutral-weak">
      <VStack gap="x4" alignItems="stretch">
        <Text as="h2" textStyle="title2">
          {title}
        </Text>
        {children}
      </VStack>
    </Box>
  );
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <VStack gap="x2" alignItems="stretch">
      <Text textStyle="labelSm">{label}</Text>
      <SegmentedControl
        value={value}
        onValueChange={onChange}
        aria-label={label}
      >
        {options.map((option) => (
          <SegmentedControlItem key={option.value} value={option.value}>
            {option.label}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
    </VStack>
  );
}

function readSampleOptions(state: unknown): SampleOrderOptions | null {
  if (!state || typeof state !== "object" || !("sampleOrderOptions" in state))
    return null;
  return (state as { sampleOrderOptions: SampleOrderOptions })
    .sampleOrderOptions;
}

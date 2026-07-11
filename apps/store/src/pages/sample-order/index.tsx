import { calculateSampleOrderMutation } from "@essesion/api-client/query";
import {
  ActionButton,
  AttachmentDisplayField,
  Box,
  Callout,
  Divider,
  SegmentedControl,
  SegmentedControlItem,
  snackbar,
  Text,
  TextAreaField,
  VStack,
} from "@essesion/shared";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
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

const MAX_IMAGES = 6;

export function SampleOrderPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { requireAuth } = useAuthGuard();
  const restored = readSampleOptions(location.state);
  const [options, setOptions] = useState<SampleOrderOptions>(
    restored ?? DEFAULT_SAMPLE_ORDER_OPTIONS,
  );
  const [files, setFiles] = useState<File[]>([]);
  const [totalCost, setTotalCost] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const calculation = useMutation(calculateSampleOrderMutation());
  const calculationVersion = useRef(0);
  const apiOptions = useMemo(() => sampleOrderApiOptions(options), [options]);
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

  useEffect(() => {
    const version = ++calculationVersion.current;
    const timeout = window.setTimeout(() => {
      void calculation
        .mutateAsync({
          body: { sample_type: options.sampleType, options: apiOptions },
        })
        .then((result) => {
          if (calculationVersion.current === version)
            setTotalCost(result.total_cost);
        })
        .catch(() => {
          if (calculationVersion.current === version) setTotalCost(null);
        });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [apiOptions, calculation.mutateAsync, options.sampleType]);

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
            description="대량 제작 전에 원단과 봉제 품질을 확인할 수 있습니다."
          />
        </SummaryCard.Root>
      }
      actionBar={
        <VStack gap="x2" alignItems="stretch">
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
          <Text textStyle="caption" color="fg.neutral-muted" align="center">
            배송지와 쿠폰은 주문서에서 선택합니다.
          </Text>
        </VStack>
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
            <Choice
              label="원단 조합"
              value={`${options.fabricType}-${options.designType}`}
              options={[
                { value: "POLY-PRINTING", label: "폴리 · 날염" },
                { value: "POLY-YARN_DYED", label: "폴리 · 선염" },
                { value: "SILK-PRINTING", label: "실크 · 날염" },
                { value: "SILK-YARN_DYED", label: "실크 · 선염" },
              ]}
              onChange={(value) => {
                const [fabricType, designType] = value.split("-") as [
                  SampleOrderOptions["fabricType"],
                  SampleOrderOptions["designType"],
                ];
                setOptions((current) => ({
                  ...current,
                  fabricType,
                  designType,
                }));
              }}
            />
          </SampleSection>
        ) : null}

        <SampleSection title="3. 봉제 사양">
          <VStack gap="x4" alignItems="stretch">
            <Choice
              label="타이 방식"
              value={options.tieType}
              options={[
                { value: "AUTO", label: "자동 타이" },
                { value: "MANUAL", label: "수동 타이" },
              ]}
              onChange={(value) =>
                update("tieType", value as SampleOrderOptions["tieType"])
              }
            />
            <Choice
              label="심지"
              value={options.interlining}
              options={[
                { value: "WOOL", label: "울 심지" },
                { value: "POLY", label: "폴리 심지" },
              ]}
              onChange={(value) =>
                update(
                  "interlining",
                  value as SampleOrderOptions["interlining"],
                )
              }
            />
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

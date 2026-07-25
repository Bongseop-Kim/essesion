import type {
  AuthoringExampleDetailOut,
  MotifSummaryOut,
} from "@essesion/api-client";
import {
  createAuthoringExampleMutation,
  listAdminMotifsOptions,
  listAuthoringExamplesQueryKey,
  previewAuthoringExampleMutation,
} from "@essesion/api-client/query";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  ActionButton,
  Box,
  Callout,
  ContentPlaceholder,
  Grid,
  HStack,
  ResponsiveModal,
  SelectBox,
  SelectBoxItem,
  Skeleton,
  snackbar,
  Text,
  TextAreaField,
  TextField,
  VStack,
} from "@essesion/shared";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { getErrorMessage } from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { SafeSvgPreview } from "../generation/safe-svg-preview";

const DEFAULT_AUTHORING_PLAN = {
  colors: ["#F4EFE6", "#213547"], // harness-ignore -- DesignPlanV3 data, not UI styling
  ground_color_index: 0,
  motifs: [{ source: "input", input_index: 1 }],
  layers: [
    {
      type: "motif",
      motif_index: 0,
      size_ratio: 0.18,
      color_indices: [1],
      placement: {
        type: "lattice",
        columns: 4,
        rows: 4,
        drop: "none",
        fixed_rotation_deg: 0,
      },
    },
  ],
} satisfies Record<string, unknown>;

type ParsedPlan =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string };

function parsePlan(value: string): ParsedPlan {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return { ok: false, message: "Plan은 JSON 객체여야 합니다." };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, message: "올바른 JSON 형식으로 입력해 주세요." };
  }
}

function motifLabel(motif: MotifSummaryOut) {
  return motif.subject?.trim() || motif.id;
}

function MotifPicker({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const [openValues, setOpenValues] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const query = useQuery({
    ...listAdminMotifsOptions({
      query: {
        q: search.trim() || undefined,
        limit: 100,
        offset: 0,
      },
    }),
    placeholderData: keepPreviousData,
    enabled: openValues.includes("motifs"),
  });

  return (
    <Accordion
      value={openValues}
      onValueChange={setOpenValues}
      variant="separated"
    >
      <AccordionItem value="motifs">
        <AccordionTrigger disabled={disabled}>
          프리뷰 모티프 · {value.length}/2
        </AccordionTrigger>
        <AccordionContent>
          <VStack gap="x4" alignItems="stretch" pt="x2">
            <Text textStyle="caption" color="fg.neutral-muted">
              Plan의 input_index 순서대로 최대 2개를 지정합니다. 카탈로그
              모티프만 사용하며 생성형 호출은 하지 않습니다.
            </Text>
            <TextField
              label="모티프 검색"
              placeholder="이름 또는 ID"
              value={search}
              maxLength={100}
              disabled={disabled}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
            {query.isLoading ? (
              <VStack gap="x3" alignItems="stretch" aria-busy="true">
                <Skeleton preset="line" />
                <Skeleton preset="line" />
                <Skeleton preset="line" />
              </VStack>
            ) : query.isError ? (
              <ContentPlaceholder
                title="모티프를 불러오지 못했습니다"
                action={
                  <ActionButton onClick={() => void query.refetch()}>
                    다시 시도
                  </ActionButton>
                }
              />
            ) : query.data?.items.length === 0 ? (
              <ContentPlaceholder title="조건에 맞는 모티프가 없습니다" />
            ) : (
              <SelectBox
                multiple
                value={value}
                aria-label="프리뷰 모티프"
                onValueChange={(next) =>
                  onChange((Array.isArray(next) ? next : [next]).slice(0, 2))
                }
              >
                {query.data?.items.map((motif) => (
                  <SelectBoxItem
                    key={motif.id}
                    value={motif.id}
                    label={motifLabel(motif)}
                    description={`${motif.id} · ${motif.color_slot_count}색 슬롯`}
                    disabled={
                      disabled ||
                      (value.length >= 2 && !value.includes(motif.id))
                    }
                  />
                ))}
              </SelectBox>
            )}
          </VStack>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export type AuthoringExampleFormValue = {
  retrievalText: string;
  plan: Record<string, unknown>;
  motifIds: string[];
};

export function AuthoringExampleForm({
  initialRetrievalText = "",
  initialPlan = DEFAULT_AUTHORING_PLAN,
  submitLabel,
  submitting,
  submitError,
  onSubmit,
}: {
  initialRetrievalText?: string;
  initialPlan?: Record<string, unknown>;
  submitLabel: string;
  submitting: boolean;
  submitError?: unknown;
  onSubmit: (value: AuthoringExampleFormValue) => void;
}) {
  const [retrievalText, setRetrievalText] = useState(initialRetrievalText);
  const [planText, setPlanText] = useState(() =>
    JSON.stringify(initialPlan, null, 2),
  );
  const [motifIds, setMotifIds] = useState<string[]>([]);
  const parsedPlan = useMemo(() => parsePlan(planText), [planText]);
  const preview = useMutation(previewAuthoringExampleMutation());
  const retrievalValid = retrievalText.trim().length >= 10;
  const previewCurrent = preview.isSuccess;

  return (
    <Box
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!parsedPlan.ok || !retrievalValid || !previewCurrent) return;
        onSubmit({
          retrievalText: retrievalText.trim(),
          plan: parsedPlan.value,
          motifIds,
        });
      }}
    >
      <VStack gap="x5" alignItems="stretch">
        <Grid columns={{ base: 1, lg: 2 }} gap="x5">
          <VStack gap="x4" alignItems="stretch">
            <TextAreaField
              label="검색 intent"
              description="검색(RAG)에 주입할 사용자 intent를 10자 이상 입력합니다."
              required
              rows={4}
              maxLength={500}
              value={retrievalText}
              disabled={submitting}
              errorMessage={
                retrievalText !== "" && !retrievalValid
                  ? "공백을 제외하고 10자 이상 입력해 주세요."
                  : undefined
              }
              onChange={(event) => setRetrievalText(event.currentTarget.value)}
            />
            <TextAreaField
              label="DesignPlanV3 JSON"
              description="서버가 Plan v3로 검증하고 family·tags·fingerprint를 자동 산출합니다."
              required
              rows={18}
              value={planText}
              disabled={submitting}
              errorMessage={parsedPlan.ok ? undefined : parsedPlan.message}
              onChange={(event) => {
                setPlanText(event.currentTarget.value);
                preview.reset();
              }}
            />
            <MotifPicker
              value={motifIds}
              disabled={submitting}
              onChange={(next) => {
                setMotifIds(next);
                preview.reset();
              }}
            />
            <HStack gap="x2" wrap>
              <ActionButton
                type="button"
                variant="neutralOutline"
                loading={preview.isPending}
                disabled={!parsedPlan.ok || submitting}
                onClick={() => {
                  if (!parsedPlan.ok) return;
                  preview.mutate({
                    body: {
                      plan: parsedPlan.value,
                      motif_ids: motifIds,
                      tile_mm: 48,
                    },
                  });
                }}
              >
                타일 프리뷰
              </ActionButton>
              <ActionButton
                type="submit"
                variant="brandSolid"
                loading={submitting}
                disabled={
                  !parsedPlan.ok ||
                  !retrievalValid ||
                  !previewCurrent ||
                  preview.isPending
                }
              >
                {submitLabel}
              </ActionButton>
            </HStack>
            {!previewCurrent && preview.data !== undefined && (
              <Text textStyle="caption" color="fg.neutral-muted">
                Plan 또는 모티프가 바뀌었습니다. 다시 프리뷰해 주세요.
              </Text>
            )}
            {submitError !== undefined && (
              <Callout
                role="alert"
                tone="critical"
                title="시범을 저장하지 못했습니다"
                description={getErrorMessage(
                  submitError,
                  "입력과 최신 상태를 확인한 뒤 다시 시도해 주세요.",
                )}
              />
            )}
          </VStack>

          <AdminCard
            title="타일 프리뷰"
            description="LLM·Recraft 없이 Plan과 카탈로그 모티프만으로 렌더합니다."
          >
            {preview.isPending ? (
              <Skeleton width="100%" height={320} />
            ) : preview.isError ? (
              <Callout
                role="alert"
                tone="critical"
                title="프리뷰를 만들지 못했습니다"
                description={getErrorMessage(
                  preview.error,
                  "Plan 구조와 모티프 input_index를 확인해 주세요.",
                )}
              />
            ) : preview.data === undefined ? (
              <ContentPlaceholder
                title="프리뷰를 실행해 주세요"
                description="검증된 현재 프리뷰가 있어야 저장할 수 있습니다."
              />
            ) : (
              <VStack gap="x3" alignItems="stretch">
                <SafeSvgPreview
                  svg={preview.data.svg}
                  status="safe"
                  alt="저작 시범 타일 프리뷰"
                />
                {preview.data.warnings.length > 0 && (
                  <Callout
                    tone="warning"
                    title="일부 모티프 레이어가 제외되었습니다"
                    description={preview.data.warnings.join(" · ")}
                  />
                )}
              </VStack>
            )}
          </AdminCard>
        </Grid>
      </VStack>
    </Box>
  );
}

export function CreateAuthoringExampleModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (value: AuthoringExampleDetailOut) => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    ...createAuthoringExampleMutation(),
    onSuccess: async (value) => {
      snackbar("새 RAG 시범을 비활성 상태로 저장했습니다.");
      await queryClient.invalidateQueries({
        queryKey: listAuthoringExamplesQueryKey(),
      });
      onCreated(value);
    },
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => {
        if (!mutation.isPending) onOpenChange(next);
      }}
      title="새 시범 작성"
      description="intent와 Plan을 작성하고 실제 타일을 확인한 뒤 저장합니다."
      size="medium"
      showCloseButton
    >
      <AuthoringExampleForm
        submitLabel="비활성 시범 저장"
        submitting={mutation.isPending}
        submitError={mutation.isError ? mutation.error : undefined}
        onSubmit={(value) => {
          mutation.mutate({
            body: {
              retrieval_text: value.retrievalText,
              plan: value.plan,
              motif_ids: value.motifIds,
            },
          });
        }}
      />
    </ResponsiveModal>
  );
}

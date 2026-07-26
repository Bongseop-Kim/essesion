import { previewAuthoringExampleMutation } from "@essesion/api-client/query";
import {
  ActionButton,
  Box,
  Callout,
  ContentPlaceholder,
  Grid,
  ProgressCircle,
  Skeleton,
  Text,
  TextAreaField,
  VStack,
} from "@essesion/shared";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { getErrorMessage } from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { SafeSvgPreview } from "../generation/safe-svg-preview";
import { MotifPicker } from "./motif-picker";
import { PlanEditor } from "./plan-editor";
import {
  type DesignPlan,
  EMPTY_PLAN,
  MAX_COLORS,
  MIN_COLORS,
  motifSources,
  normalizeHex,
  syncMotifLayers,
  unusedMotifSlots,
} from "./plan-model";

const PREVIEW_DEBOUNCE_MS = 400;
const MIN_RETRIEVAL_LENGTH = 10;

export type AuthoringExampleFormValue = {
  retrievalText: string;
  plan: Record<string, unknown>;
  motifIds: string[];
};

export function AuthoringExampleForm({
  initialRetrievalText = "",
  initialPlan,
  initialMotifIds = [],
  submitLabel,
  submitting,
  submitDisabled = false,
  submitError,
  onSubmit,
}: {
  initialRetrievalText?: string;
  /* 저장된 Plan은 서버가 DesignPlanV3로 검증하고 model_dump한 값이라 기본값까지 채워져 있다 */
  initialPlan?: Record<string, unknown>;
  initialMotifIds?: string[];
  submitLabel: string;
  submitting: boolean;
  submitDisabled?: boolean;
  submitError?: unknown;
  onSubmit: (value: AuthoringExampleFormValue) => void;
}) {
  const [retrievalText, setRetrievalText] = useState(initialRetrievalText);
  const [plan, setPlan] = useState<DesignPlan>(
    () => (initialPlan as DesignPlan | undefined) ?? EMPTY_PLAN,
  );
  const [motifIds, setMotifIds] = useState(() => [...initialMotifIds]);
  const [motifLabels, setMotifLabels] = useState<Record<string, string>>({});
  const [previewedSignature, setPreviewedSignature] = useState<string>();

  const motifNames = motifIds.map((id) => motifLabels[id] ?? id);
  const previewBody = useMemo(
    () => ({
      plan: { ...plan, motifs: motifSources(motifIds.length) },
      motif_ids: motifIds,
      tile_mm: 48,
    }),
    [plan, motifIds],
  );
  const previewSignature = useMemo(
    () => JSON.stringify(previewBody),
    [previewBody],
  );

  const normalizedColors = plan.colors.map(normalizeHex);
  const colorsReady =
    plan.colors.length >= MIN_COLORS &&
    plan.colors.length <= MAX_COLORS &&
    normalizedColors.every((color) => color !== null) &&
    new Set(normalizedColors).size === normalizedColors.length;
  const unusedMotifs = unusedMotifSlots(plan.layers, motifIds.length);
  /* 서버 422가 확실한 입력으로는 프리뷰를 쏘지 않는다 — 편집기가 이미 사유를 보여준다 */
  const previewReady = colorsReady && unusedMotifs.length === 0;
  const retrievalValid = retrievalText.trim().length >= MIN_RETRIEVAL_LENGTH;

  const preview = useMutation({
    ...previewAuthoringExampleMutation(),
    onSuccess: (_value, variables) => {
      setPreviewedSignature(JSON.stringify(variables.body));
    },
  });
  const previewMutate = preview.mutate;
  const previewCurrent =
    preview.isSuccess && previewedSignature === previewSignature;

  useEffect(() => {
    if (!previewReady || submitting) return;
    if (previewedSignature === previewSignature) return;
    const timer = setTimeout(
      () => previewMutate({ body: previewBody }),
      PREVIEW_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [
    previewBody,
    previewSignature,
    previewedSignature,
    previewReady,
    submitting,
    previewMutate,
  ]);

  return (
    <Box
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!retrievalValid || !previewCurrent) return;
        onSubmit({
          retrievalText: retrievalText.trim(),
          plan: previewBody.plan,
          motifIds,
        });
      }}
    >
      <Grid columns={{ base: 1, lg: 2 }} gap="x5" alignItems="start">
        <VStack gap="x5" alignItems="stretch">
          <AdminCard
            title="검색 대상"
            description="이 시범이 어떤 요청에 딸려 나갈지 정하는 부분입니다."
          >
            <VStack gap="x4" alignItems="stretch">
              <TextAreaField
                label="예시 사용자 요청문"
                description="사용자가 이렇게 요청했을 때 이 Plan을 시범으로 붙입니다. 이 문장이 임베딩되어 벡터 검색 대상이 됩니다."
                required
                rows={3}
                maxLength={500}
                value={retrievalText}
                disabled={submitting}
                errorMessage={
                  retrievalText !== "" && !retrievalValid
                    ? `공백을 제외하고 ${MIN_RETRIEVAL_LENGTH}자 이상 입력해 주세요.`
                    : undefined
                }
                onChange={(event) =>
                  setRetrievalText(event.currentTarget.value)
                }
              />
              <MotifPicker
                value={motifIds}
                labels={motifLabels}
                disabled={submitting}
                onChange={(ids, labels) => {
                  setMotifIds(ids);
                  setMotifLabels(labels);
                  setPlan((current) => ({
                    ...current,
                    layers: syncMotifLayers(current.layers, ids.length),
                  }));
                }}
              />
            </VStack>
          </AdminCard>

          <PlanEditor
            value={plan}
            motifNames={motifNames}
            disabled={submitting}
            onChange={setPlan}
          />
        </VStack>

        <Box position={{ base: "static", lg: "sticky" }} top="x4">
          <AdminCard
            title="타일 프리뷰"
            description="바꾸면 바로 다시 그립니다. LLM·Recraft 없이 Plan과 카탈로그 모티프만으로 렌더합니다."
          >
            <VStack gap="x4" alignItems="stretch">
              {!previewReady ? (
                <ContentPlaceholder
                  title="입력을 먼저 정리해 주세요"
                  description={
                    colorsReady
                      ? "고른 모티프를 레이어에서 모두 써야 프리뷰를 그릴 수 있습니다."
                      : "팔레트의 HEX 값이 서로 다른 올바른 색이어야 합니다."
                  }
                />
              ) : preview.isPending && preview.data === undefined ? (
                <Skeleton width="100%" height={320} />
              ) : preview.isError ? (
                <Callout
                  role="alert"
                  tone="critical"
                  title="프리뷰를 만들지 못했습니다"
                  description={getErrorMessage(
                    preview.error,
                    "Plan 값의 범위와 모티프 사용을 확인해 주세요.",
                  )}
                />
              ) : preview.data === undefined ? (
                <Skeleton width="100%" height={320} />
              ) : (
                <>
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
                </>
              )}

              {previewReady && preview.isPending && (
                <Text
                  textStyle="caption"
                  color="fg.neutral-muted"
                  aria-live="polite"
                >
                  <ProgressCircle size={16} /> 프리뷰를 다시 그리는 중입니다.
                </Text>
              )}

              <ActionButton
                type="submit"
                variant="brandSolid"
                loading={submitting}
                disabled={!retrievalValid || !previewCurrent || submitDisabled}
              >
                {submitLabel}
              </ActionButton>

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
          </AdminCard>
        </Box>
      </Grid>
    </Box>
  );
}

import {
  ActionButton,
  Box,
  Callout,
  Grid,
  ProgressCircle,
  Text,
  TextAreaField,
  VStack,
} from "@essesion/shared";
import { useMemo, useState } from "react";

import { getErrorMessage } from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { MotifPicker } from "./motif-picker";
import { PlanPreviewCard } from "./plan-preview";

const MIN_RETRIEVAL_LENGTH = 10;

/* 빈 화면에서 시작하지 않게 두는 최소 유효 Plan — 값의 정본은 서버 스키마(DesignPlanV3)다 */
const STARTER_PLAN = {
  colors: ["#F4EFE6", "#213547"], // harness-ignore -- DesignPlanV3 데이터, UI 스타일이 아님
  ground_color_index: 0,
  motifs: [],
  layers: [
    {
      type: "stripe",
      direction: "vertical",
      period_ratio: 0.5,
      bands: [{ offset_ratio: 0, width_ratio: 0.25, color_index: 1 }],
    },
  ],
};

/* ponytail: Plan 검증은 서버(DesignPlanV3)에 맡기고 여기서는 JSON 파싱만 본다.
   피커로 스키마를 미러링하면 enum·범위가 늘 때마다 화면이 뒤처진다 */
function parsePlan(
  text: string,
): { plan: Record<string, unknown> } | { error: string } {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { error: "Plan은 JSON 객체여야 합니다." };
    }
    return { plan: value as Record<string, unknown> };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "JSON을 해석할 수 없습니다.",
    };
  }
}

export const planJsonText = (plan: Record<string, unknown>) =>
  JSON.stringify(plan, null, 2);

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
  onCancel,
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
  onCancel?: () => void;
}) {
  const [retrievalText, setRetrievalText] = useState(initialRetrievalText);
  const [planText, setPlanText] = useState(() =>
    planJsonText(initialPlan ?? STARTER_PLAN),
  );
  const [motifIds, setMotifIds] = useState(() => [...initialMotifIds]);
  const [motifLabels, setMotifLabels] = useState<Record<string, string>>({});

  const parsed = useMemo(() => parsePlan(planText), [planText]);
  const plan = "plan" in parsed ? parsed.plan : undefined;
  const retrievalValid = retrievalText.trim().length >= MIN_RETRIEVAL_LENGTH;

  return (
    <Box
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!retrievalValid || plan === undefined) return;
        onSubmit({ retrievalText: retrievalText.trim(), plan, motifIds });
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
                }}
              />
            </VStack>
          </AdminCard>

          <AdminCard
            title="Plan JSON"
            description="DesignPlanV3 원문을 그대로 붙여 넣습니다. 범위·enum 검증은 프리뷰 응답(서버)이 합니다."
          >
            <TextAreaField
              label="Plan (DesignPlanV3)"
              description="고른 모티프는 motifs의 input_index 1..N으로 순서대로 참조해야 합니다. 모티프를 고르지 않으면 catalog source도 쓸 수 있습니다."
              required
              rows={24}
              spellCheck={false}
              value={planText}
              disabled={submitting}
              errorMessage={"error" in parsed ? parsed.error : undefined}
              onChange={(event) => setPlanText(event.currentTarget.value)}
            />
          </AdminCard>
        </VStack>

        {/* 스티키 기준선은 sticky Header(md+ 64px = x16) 아래 — 안 그러면 헤더에 가린다 */}
        <Box
          position={{ base: "static", lg: "sticky" }}
          top="calc(var(--spacing-x16) + var(--spacing-x4))"
        >
          <PlanPreviewCard
            plan={plan}
            motifIds={motifIds}
            paused={submitting}
            footer={({ current, pending }) => (
              <VStack gap="x4" alignItems="stretch">
                {/* 저장은 이 화면의 마지막 액션 — 구분선 아래 large로 고정한다.
                    진행 문구는 버튼 아래에 둬야 버튼 위치가 흔들리지 않는다 */}
                <VStack gap="x2" alignItems="stretch">
                  <ActionButton
                    type="submit"
                    variant="brandSolid"
                    size="large"
                    loading={submitting}
                    disabled={!retrievalValid || !current || submitDisabled}
                  >
                    {submitLabel}
                  </ActionButton>
                  {onCancel !== undefined && (
                    <ActionButton
                      variant="ghost"
                      disabled={submitting}
                      onClick={onCancel}
                    >
                      편집 취소
                    </ActionButton>
                  )}
                  <Text
                    textStyle="caption"
                    color="fg.neutral-muted"
                    aria-live="polite"
                  >
                    {plan !== undefined && pending ? (
                      <>
                        <ProgressCircle size={16} /> 프리뷰를 다시 그리는
                        중입니다.
                      </>
                    ) : !retrievalValid ? (
                      "예시 사용자 요청문을 입력하면 저장할 수 있습니다."
                    ) : (
                      "현재 프리뷰 그대로 저장합니다."
                    )}
                  </Text>
                </VStack>

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
            )}
          />
        </Box>
      </Grid>
    </Box>
  );
}

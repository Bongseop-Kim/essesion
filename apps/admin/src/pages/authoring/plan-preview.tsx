import { previewAuthoringExampleMutation } from "@essesion/api-client/query";
import {
  Box,
  Callout,
  ContentPlaceholder,
  type DesignPreviewMode,
  Divider,
  SegmentedControl,
  SegmentedControlItem,
  Skeleton,
  TieCanvas,
  VStack,
} from "@essesion/shared";
import { useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import { getErrorMessage } from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { SafeSvgPreview } from "../generation/safe-svg-preview";

const PREVIEW_DEBOUNCE_MS = 400;
/* 컬럼 폭을 다 쓰되, 스크롤 전(페이지 제목 아래) 위치에서도 카드가 통째로 보이도록
   높이를 캡한다 — 27rem = 제목 영역 + 카드 크롬(헤더·구분선·저장 버튼·안내) */
const PREVIEW_SIZE = "min(100%, calc(100dvh - 27rem))";

/* TieCanvas는 SVG를 background-image로 반복시켜서 data URI가 필요하다 */
const svgToDataUri = (svg: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

/** 프리뷰가 현재 Plan과 일치하는지 — 저장 버튼의 잠금 조건 */
export type PlanPreviewState = { current: boolean; pending: boolean };

/** Plan JSON을 서버 compile-preview로 그리는 카드. 저작 폼과 상세 화면이 같은 렌더를 쓴다. */
export function PlanPreviewCard({
  plan,
  motifIds,
  paused = false,
  footer,
}: {
  /** JSON이 아직 유효하지 않으면 undefined */
  plan?: Record<string, unknown>;
  motifIds: string[];
  /** 저장 중에는 다시 그리지 않는다 */
  paused?: boolean;
  footer?: (state: PlanPreviewState) => ReactNode;
}) {
  const [previewedSignature, setPreviewedSignature] = useState<string>();
  const [previewMode, setPreviewMode] = useState<DesignPreviewMode>("tie");

  const body = useMemo(
    () =>
      plan === undefined
        ? undefined
        : { plan, motif_ids: motifIds, tile_mm: 48 },
    [plan, motifIds],
  );
  const signature = useMemo(() => JSON.stringify(body), [body]);

  const preview = useMutation({
    ...previewAuthoringExampleMutation(),
    onSuccess: (_value, variables) => {
      setPreviewedSignature(JSON.stringify(variables.body));
    },
  });
  const previewMutate = preview.mutate;
  const current = preview.isSuccess && previewedSignature === signature;

  useEffect(() => {
    if (body === undefined || paused) return;
    if (previewedSignature === signature) return;
    const timer = setTimeout(
      () => previewMutate({ body }),
      PREVIEW_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [body, signature, previewedSignature, paused, previewMutate]);

  return (
    <AdminCard
      title="프리뷰"
      description="바꾸면 바로 다시 그립니다. 외부 모델 호출 없이 Plan과 카탈로그 모티프만으로 렌더합니다."
      action={
        <SegmentedControl
          value={previewMode}
          onValueChange={(value) => setPreviewMode(value as DesignPreviewMode)}
          aria-label="미리보기 방식"
        >
          <SegmentedControlItem value="repeat">타일</SegmentedControlItem>
          <SegmentedControlItem value="tie">넥타이</SegmentedControlItem>
        </SegmentedControl>
      }
    >
      <VStack gap="x4" alignItems="stretch">
        {plan === undefined ? (
          <ContentPlaceholder
            title="Plan JSON이 아직 유효하지 않습니다"
            description="JSON 문법을 고치면 바로 프리뷰를 다시 그립니다."
          />
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
          <Skeleton
            width={PREVIEW_SIZE}
            radius="r4"
            className="self-center"
            style={{ aspectRatio: 1 }}
          />
        ) : (
          <>
            <Box maxWidth={PREVIEW_SIZE} width="full" alignSelf="center">
              {previewMode === "repeat" ? (
                <SafeSvgPreview
                  svg={preview.data.svg}
                  status="safe"
                  alt="저작 시범 프리뷰"
                />
              ) : (
                <TieCanvas
                  imageSrc={svgToDataUri(preview.data.svg)}
                  mode="tie"
                  alt="저작 시범 프리뷰"
                />
              )}
            </Box>
            {preview.data.warnings.length > 0 && (
              <Callout
                tone="warning"
                /* 경고 원문은 모티프 제외·스트라이프 주기 스냅 등 여러 종류라
                   제목은 중립으로 두고 사유는 원문으로 보여준다 */
                title="프리뷰를 그리며 일부 값을 보정했습니다"
                description={preview.data.warnings.join(" · ")}
              />
            )}
          </>
        )}

        {footer !== undefined && (
          <>
            <Divider />
            {footer({ current, pending: preview.isPending })}
          </>
        )}
      </VStack>
    </AdminCard>
  );
}

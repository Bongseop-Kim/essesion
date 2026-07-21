import type { SafeCandidateOut, SeamlessDetailOut } from "@essesion/api-client";
import {
  createAdminSeamlessReferenceImageReadUrlMutation,
  getAdminSeamlessLogOptions,
} from "@essesion/api-client/query";
import {
  ActionButton,
  Article,
  Box,
  Callout,
  ContentPlaceholder,
  Grid,
  HStack,
  ImageFrame,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";

import {
  formatDateTime,
  formatFileSize,
  formatIdentifier,
} from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { DetailList } from "../../shared/ui/detail-list";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";
import { TechnicalDetails } from "../../shared/ui/technical-details";
import {
  FAILURE_STAGE_LABELS,
  GENERATION_MODE_LABELS,
} from "./generation-labels";
import { SafeSvgPreview } from "./safe-svg-preview";

function formatMilliseconds(value: number | null) {
  return value === null
    ? "-"
    : `${Math.round(value).toLocaleString("ko-KR")}ms`;
}

const SEAMLESS_STATUS_LABELS: Readonly<
  Record<SeamlessDetailOut["status"], string>
> = {
  success: "성공",
  partial: "부분 성공",
  error: "오류",
};

const INPUT_TYPE_LABELS: Readonly<Record<string, string>> = {
  intent: "구조화된 디자인 의도",
  prompt: "텍스트 프롬프트",
  reference_image: "참고 이미지",
};

function inputTypeLabel(inputType: string) {
  return INPUT_TYPE_LABELS[inputType] ?? "알 수 없는 입력 방식";
}

function warningPresentation(code: string) {
  if (code === "preview_unavailable") {
    return {
      title: "미리보기를 저장하지 못했습니다",
      description:
        "후보 SVG를 확인하고, 이미지 미리보기가 필요하면 생성을 다시 실행해 주세요.",
    };
  }
  if (code === "partial_candidates") {
    return {
      title: "후보가 일부만 생성되었습니다",
      description:
        "반환된 후보를 검토하고, 선택지가 부족하면 같은 조건으로 다시 생성해 주세요.",
    };
  }
  return {
    title: "생성 결과를 확인해 주세요",
    description:
      "입력 조건과 반환된 후보를 검토하고, 결과가 적합하지 않으면 다시 생성해 주세요.",
  };
}

function CandidateCard({
  candidate,
  index,
}: {
  candidate: SafeCandidateOut;
  index: number;
}) {
  const label = `후보 ${index + 1}`;
  return (
    <AdminCard title={label}>
      <SafeSvgPreview
        svg={candidate.svg}
        status={candidate.svg_status}
        alt={`${label} 안전 미리보기`}
      />
    </AdminCard>
  );
}

function SeamlessReferenceImage({
  logId,
  imageId,
}: {
  logId: string;
  imageId: string;
}) {
  const [readUrl, setReadUrl] = useState<string>();
  const mutation = useMutation({
    ...createAdminSeamlessReferenceImageReadUrlMutation(),
    onSuccess: (data) => setReadUrl(data.read_url),
  });

  return (
    <AdminCard
      title="입력 이미지"
      description="로그와 연결된 비공개 원본에 한해 만료 URL을 발급합니다."
    >
      <VStack gap="x3" alignItems="stretch">
        <Box maxWidth={640}>
          <ImageFrame
            src={readUrl}
            alt="Seamless 입력 참고 이미지"
            ratio={4 / 3}
            fit="contain"
            stroke
          />
        </Box>
        <ActionButton
          size="small"
          variant="neutralOutline"
          loading={mutation.isPending}
          onClick={() =>
            mutation.mutate({
              path: { log_id: logId, image_id: imageId },
            })
          }
        >
          {readUrl === undefined ? "입력 이미지 보기" : "URL 재발급"}
        </ActionButton>
        {mutation.isError && (
          <Callout
            role="alert"
            tone="critical"
            title="입력 이미지를 불러오지 못했습니다"
            description="이미지가 만료되었거나 이 생성 로그와 연결되어 있지 않습니다."
          />
        )}
      </VStack>
    </AdminCard>
  );
}

function SeamlessDetailLoading() {
  return (
    <VStack gap="x6" alignItems="stretch" aria-busy="true">
      <RouteHeading
        title="Seamless 로그 상세"
        description="생성 결과와 성능 정보를 안전하게 확인합니다."
      />
      <AdminCard title="로그 정보">
        <VStack gap="x3" alignItems="stretch">
          <Skeleton width="60%" height={24} />
          <Skeleton width="100%" height={20} />
          <Skeleton width="80%" height={20} />
        </VStack>
      </AdminCard>
      <AdminCard title="후보 결과">
        <Skeleton width="100%" height={280} />
      </AdminCard>
    </VStack>
  );
}

export function SeamlessLogDetailPage() {
  const { logId = "" } = useParams();
  const query = useQuery({
    ...getAdminSeamlessLogOptions({ path: { log_id: logId } }),
    enabled: logId !== "",
  });

  if (query.isLoading) return <SeamlessDetailLoading />;

  if (query.isError || query.data === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading
          title="Seamless 로그 상세"
          description="생성 결과와 성능 정보를 안전하게 확인합니다."
        />
        <ContentPlaceholder
          title="Seamless 로그를 불러오지 못했습니다"
          description="로그 ID를 확인하거나 다시 시도해 주세요."
          action={
            <ActionButton onClick={() => void query.refetch()}>
              다시 시도
            </ActionButton>
          }
        />
      </VStack>
    );
  }

  const log = query.data;

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title="Seamless 로그 상세"
          description="서버가 다시 검사한 SVG만 격리된 이미지로 표시합니다."
        />
        <StatusBadge status={log.status} />
      </HStack>

      {log.error_summary !== null && (
        <Callout
          tone="critical"
          title="생성 오류"
          description={log.error_summary}
        />
      )}

      <AdminCard title="로그 정보">
        <DetailList
          items={[
            { label: "상태", value: SEAMLESS_STATUS_LABELS[log.status] },
            { label: "입력 유형", value: inputTypeLabel(log.input_type) },
            {
              label: "프롬프트",
              value: log.has_prompt ? "있음" : "없음",
            },
            {
              label: "참고 이미지",
              value: log.has_reference_image
                ? `있음 (${formatFileSize(log.reference_image_bytes)})`
                : "없음",
            },
            { label: "생성 시각", value: formatDateTime(log.created_at) },
          ]}
        />
      </AdminCard>

      {log.prompt !== null && (
        <AdminCard
          title="프롬프트 원문"
          description="사용자가 디자인 생성 시 입력한 내용입니다."
        >
          <Article>
            <Text
              as="p"
              textStyle="bodySm"
              color="fg.neutral"
              className="whitespace-pre-wrap"
            >
              {log.prompt}
            </Text>
          </Article>
        </AdminCard>
      )}

      {log.intents.length > 0 && (
        <AdminCard
          title="생성 Intent"
          description="프롬프트 해석 후 검증·제약 적용·모티프 해석까지 끝난 엔진 입력입니다."
        >
          <VStack gap="x3" alignItems="stretch">
            {log.intents.map((intent, index) => (
              <TechnicalDetails
                key={index}
                title={`Intent ${index + 1} JSON`}
                json={intent}
              />
            ))}
          </VStack>
        </AdminCard>
      )}

      {log.reference_image_id !== null && log.reference_image_available && (
        <SeamlessReferenceImage
          key={`${log.id}:${log.reference_image_id}`}
          logId={log.id}
          imageId={log.reference_image_id}
        />
      )}

      <AdminCard title="성능·후보 집계">
        <DetailList
          items={[
            {
              label: "요청 / 반환 후보",
              value: `${log.candidate_count_requested ?? "-"} / ${log.candidate_count_returned ?? 0}`,
            },
            {
              label: "고유 레이아웃",
              value: formatIdentifier(log.distinct_layouts),
            },
            {
              label: "사용 가능 전략",
              value: formatIdentifier(log.available_strategies),
            },
            { label: "생성 시간", value: formatMilliseconds(log.generate_ms) },
            { label: "렌더 시간", value: formatMilliseconds(log.render_ms) },
            { label: "경고 수", value: `${log.warning_count}건` },
          ]}
        />
      </AdminCard>

      <AdminCard
        title="생성 진단"
        description="저작·검증 결과를 단계별로 표시합니다."
      >
        <DetailList
          items={[
            {
              label: "생성 방식",
              value: GENERATION_MODE_LABELS[log.diagnostics.mode ?? ""] ?? "-",
            },
            { label: "저작 모델", value: log.diagnostics.model ?? "-" },
            {
              label: "저작 시도",
              value: formatIdentifier(log.diagnostics.authoring_attempts),
            },
            {
              label: "계획 검증",
              value: `${log.diagnostics.validated_count ?? "-"} / ${log.diagnostics.plan_count ?? "-"}`,
            },
            {
              label: "해석 완료",
              value: formatIdentifier(log.diagnostics.resolved_count),
            },
            {
              label: "실패 단계",
              value:
                FAILURE_STAGE_LABELS[log.failure_stage ?? ""] ??
                log.failure_stage ??
                "-",
            },
            { label: "실패 코드", value: log.failure_code ?? "-" },
          ]}
        />
      </AdminCard>

      {log.warning_codes.length > 0 && (
        <AdminCard
          title="생성 경고"
          description={`${log.warning_count.toLocaleString("ko-KR")}건의 경고가 기록되었습니다.`}
        >
          <VStack gap="x3" alignItems="stretch">
            {log.warning_codes.map((warning) => {
              const presentation = warningPresentation(warning);
              return (
                <Callout
                  key={warning}
                  tone="warning"
                  title={presentation.title}
                  description={presentation.description}
                />
              );
            })}
          </VStack>
        </AdminCard>
      )}

      <VStack gap="x4" alignItems="stretch">
        <Text as="h2" textStyle="title2">
          후보 결과
        </Text>
        {log.candidates.length === 0 ? (
          <ContentPlaceholder
            title="표시할 후보가 없습니다"
            description="실패했거나 후보 SVG가 기록되지 않은 생성입니다."
          />
        ) : (
          <Grid columns={{ base: 2, md: 4 }} gap="x3">
            {log.candidates.map((candidate, index) => (
              <CandidateCard
                key={candidate.id ?? `${candidate.design_index}-${index}`}
                candidate={candidate}
                index={index}
              />
            ))}
          </Grid>
        )}
      </VStack>

      <Text textStyle="bodySm">
        <Link to="/generation-logs?tab=seamless">
          Seamless 로그 목록으로 돌아가기
        </Link>
      </Text>

      <TechnicalDetails
        json={{
          log_id: log.id,
          request_id: log.request_id,
          status: log.status,
          input_type: log.input_type,
          warning_codes: log.warning_codes,
          error_type: log.error_type,
          failure_code: log.failure_code,
          failure_stage: log.failure_stage,
          diagnostics: log.diagnostics,
          intent_count: log.intents.length,
          reference_image_id: log.reference_image_id,
          seed: log.seed,
          engine_version: log.engine_version,
          registry_version: log.registry_version,
          candidates: log.candidates.map((candidate) => ({
            candidate_id: candidate.id,
            design_index: candidate.design_index,
            layout_id: candidate.layout_id,
            colorway_id: candidate.colorway_id,
            source_fidelity: candidate.source_fidelity,
            seed: candidate.seed,
            svg_status: candidate.svg_status,
          })),
        }}
      />
    </VStack>
  );
}

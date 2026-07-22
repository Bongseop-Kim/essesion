import type {
  MotifResolutionOut,
  SafeCandidateOut,
  SeamlessDetailOut,
  SeamlessWarningOut,
} from "@essesion/api-client";
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
import { SafeSvgPreview } from "./safe-svg-preview";

function formatMilliseconds(value: number | null | undefined) {
  return value == null ? "-" : `${Math.round(value).toLocaleString("ko-KR")}ms`;
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

const GENERATION_MODE_LABELS: Readonly<Record<string, string>> = {
  prompt: "프롬프트 생성",
  variation: "다시 만들기",
};

const FAILURE_STAGE_LABELS: Readonly<Record<string, string>> = {
  reference: "참고 이미지",
  constraints: "사용자 설정",
  authoring: "계획 저작",
  intent: "Intent 검증",
  candidate: "후보 구성",
};

function warningPresentation(
  warning: SeamlessWarningOut,
  requested: number | null,
  returned: number | null,
) {
  const count = warning.count.toLocaleString("ko-KR");
  const items = warning.items ?? [];
  if (warning.code === "preview_unavailable") {
    return {
      title: `미리보기 ${count}개를 저장하지 못했습니다`,
      description:
        "후보 SVG를 확인하고, 이미지 미리보기가 필요하면 생성을 다시 실행해 주세요.",
    };
  }
  if (warning.code === "partial_candidates") {
    return {
      title: "후보가 일부만 생성되었습니다",
      description: `요청 ${requested ?? "-"}개 중 ${returned ?? "-"}개가 반환되었습니다. 선택지가 부족하면 같은 조건으로 다시 생성해 주세요.`,
    };
  }
  if (warning.code === "motif_layer_dropped") {
    const motifs = items.length > 0 ? items.join(", ") : "일부 모티프";
    const candidatesComplete =
      requested !== null && returned === requested
        ? ` 요청한 후보 ${returned}개는 모두 생성되었습니다.`
        : "";
    return {
      title: `모티프 레이어 ${count}개를 제외했습니다`,
      description: `${motifs} 모티프를 카탈로그 재사용 또는 외부 생성으로 해석하지 못해 해당 레이어만 제거했습니다.${candidatesComplete}`,
    };
  }
  if (warning.code === "cmyk_gamut") {
    const colors = items.length > 0 ? ` (${items.join(", ")})` : "";
    return {
      title: `CMYK 색역 확인이 필요한 색상 ${count}개`,
      description: `화면용 RGB 색상${colors}이 인쇄 시 달라질 가능성이 있습니다. 후보 생성 실패가 아니라 인쇄 전 색상 확인이 필요한 안내입니다.`,
    };
  }
  if (warning.code === "diversity_shortfall") {
    return {
      title: "후보의 레이아웃 다양성이 부족합니다",
      description:
        "후보 수는 충족했지만 서로 다른 레이아웃 수가 목표보다 적습니다. 더 다양한 선택지가 필요하면 다시 생성해 주세요.",
    };
  }
  if (warning.code === "candidate_variants_dropped") {
    return {
      title: `렌더할 수 없는 후보 변형 ${count}개를 제외했습니다`,
      description:
        "유효한 후보만 반환되었습니다. 요청/반환 후보 수가 같다면 별도 재생성은 필요하지 않습니다.",
    };
  }
  if (warning.code === "design_dropped") {
    return {
      title: `사용할 수 없는 디자인 계획 ${count}개를 제외했습니다`,
      description: "검증을 통과한 나머지 디자인 계획으로 후보를 생성했습니다.",
    };
  }
  return {
    title: `분류되지 않은 생성 경고 ${count}건`,
    description: "기술 정보의 request ID로 worker 로그를 확인해 주세요.",
  };
}

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  gemini: "Gemini",
  openai_embedding: "OpenAI 임베딩",
  recraft: "Recraft",
  worker: "Worker",
};

const RESOLUTION_LABELS: Readonly<Record<string, string>> = {
  user_exact: "사용자 직접 선택",
  prompt_catalog: "프롬프트 카탈로그 재사용",
  reference_catalog: "참고 사진 카탈로그 재사용",
  exact: "카탈로그 정확 일치 재사용 (이전 로그)",
  embedding_reuse: "임베딩 유사 모티프 재사용 (이전 로그)",
  catalog_fallback: "카탈로그 fallback 재사용 (이전 로그)",
  recraft: "Recraft 신규 생성",
  dropped: "레이어 제외",
};

const MATCH_TYPE_LABELS: Readonly<Record<string, string>> = {
  exact_token: "주제·태그 일치",
  embedding: "벡터 유사도",
  recraft: "신규 생성",
};

const REASON_LABELS: Readonly<Record<string, string>> = {
  authentication_failed: "인증 실패",
  invalid_configuration: "설정 오류",
  invalid_response: "응답 형식 오류",
  not_configured: "연동 설정 누락",
  provider_4xx: "외부 서비스 요청 거부",
  provider_5xx: "외부 서비스 장애",
  rate_limited: "요청 한도 초과",
  request_failed: "요청 실패",
  suitability_gate_failed: "SVG 적합성 검사 실패",
  timeout: "응답 시간 초과",
  transport_error: "네트워크 오류",
  unsupported_spec: "지원하지 않는 모티프 사양",
};

function motifResolutionValue(item: MotifResolutionOut) {
  const outcome =
    RESOLUTION_LABELS[item.outcome ?? ""] ?? item.outcome ?? "알 수 없음";
  const similarity =
    item.similarity == null ? "" : ` · 유사도 ${item.similarity.toFixed(3)}`;
  const failure = item.reason_code
    ? ` · ${PROVIDER_LABELS[item.provider ?? ""] ?? item.provider ?? "Worker"}: ${REASON_LABELS[item.reason_code] ?? item.reason_code}${item.status_code == null ? "" : ` (${item.status_code})`}`
    : "";
  const matchType = item.match_type
    ? ` · ${MATCH_TYPE_LABELS[item.match_type] ?? item.match_type}`
    : "";
  const motifId = item.motif_id ? ` · ${item.motif_id}` : "";
  return `${outcome}${matchType}${similarity}${motifId}${failure}`;
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
  const motifResolutions = log.diagnostics.motif_resolutions ?? [];
  const selectedCandidateIndex = log.candidates.findIndex(
    (candidate) => candidate.id === log.outcome.selected_candidate_id,
  );

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
              label: "프롬프트 리비전",
              value: log.diagnostics.prompt_revision ?? "-",
            },
            {
              label: "저작 시도",
              value: formatIdentifier(log.diagnostics.authoring_attempts),
            },
            {
              label: "계획 검증",
              value: `${log.diagnostics.validated_count ?? "-"} / ${log.diagnostics.plan_count ?? "-"}`,
            },
            {
              label: "공개 카탈로그 후보",
              value: formatIdentifier(log.diagnostics.catalog_candidate_count),
            },
            {
              label: "해석 완료",
              value: formatIdentifier(log.diagnostics.resolved_count),
            },
            {
              label: "단계별 시간",
              value: `저작 ${formatMilliseconds(log.diagnostics.authoring_ms)} · 모티프 ${formatMilliseconds(log.diagnostics.motif_resolution_ms)} · 후보 ${formatMilliseconds(log.diagnostics.candidate_ms)} · 렌더 ${formatMilliseconds(log.diagnostics.render_ms)}`,
            },
            {
              label: "실패 단계",
              value:
                FAILURE_STAGE_LABELS[log.failure_stage ?? ""] ??
                log.failure_stage ??
                "-",
            },
            { label: "실패 코드", value: log.failure_code ?? "-" },
            {
              label: "외부 연동",
              value: log.diagnostics.failure_provider
                ? `${PROVIDER_LABELS[log.diagnostics.failure_provider] ?? log.diagnostics.failure_provider} · ${log.diagnostics.failure_operation ?? "-"}`
                : "-",
            },
            {
              label: "외부 실패 사유",
              value: log.diagnostics.failure_reason
                ? `${REASON_LABELS[log.diagnostics.failure_reason] ?? log.diagnostics.failure_reason}${log.diagnostics.failure_status_code == null ? "" : ` (${log.diagnostics.failure_status_code})`}`
                : "-",
            },
          ]}
        />
      </AdminCard>

      {motifResolutions.length > 0 && (
        <AdminCard
          title="모티프 해석"
          description="직접 선택·프롬프트 검색·참고 사진·신규 생성 중 실제 적용된 출처입니다."
        >
          <DetailList
            items={motifResolutions.map((item, index) => ({
              label: item.subject ?? item.layer_id ?? `모티프 ${index + 1}`,
              value: motifResolutionValue(item),
            }))}
          />
        </AdminCard>
      )}

      {log.outcome.session_id != null && (
        <AdminCard
          title="사용자 결과"
          description="이 생성 이후 같은 디자인 세션에서 확인된 행동입니다."
        >
          <DetailList
            items={[
              {
                label: "후보 선택",
                value: log.outcome.selected_candidate_id
                  ? selectedCandidateIndex >= 0
                    ? `후보 ${selectedCandidateIndex + 1} 선택`
                    : "선택함"
                  : "선택 기록 없음",
              },
              {
                label: "후속 재생성",
                value: log.outcome.regenerated ? "있음" : "없음",
              },
              {
                label: "Finalize 완료",
                value: log.outcome.finalized ? "완료" : "없음",
              },
            ]}
          />
        </AdminCard>
      )}

      {log.warning_groups.length > 0 && (
        <AdminCard
          title="생성 경고"
          description={`${log.warning_count.toLocaleString("ko-KR")}건의 경고를 ${log.warning_groups.length.toLocaleString("ko-KR")}개 원인으로 묶었습니다.`}
        >
          <VStack gap="x3" alignItems="stretch">
            {log.warning_groups.map((warning) => {
              const presentation = warningPresentation(
                warning,
                log.candidate_count_requested,
                log.candidate_count_returned,
              );
              return (
                <Callout
                  key={warning.code}
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
          warning_groups: log.warning_groups,
          error_type: log.error_type,
          failure_code: log.failure_code,
          failure_stage: log.failure_stage,
          diagnostics: log.diagnostics,
          outcome: log.outcome,
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

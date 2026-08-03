import type {
  MotifResolutionOut,
  SeamlessDetailOut,
  SeamlessWarningOut,
} from "@essesion/api-client";
import { getAdminSeamlessLogOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  Article,
  Badge,
  Box,
  Callout,
  ContentPlaceholder,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { formatDateTime, formatIdentifier } from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { DetailList } from "../../shared/ui/detail-list";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";
import { TechnicalDetails } from "../../shared/ui/technical-details";
import {
  FAILURE_CODE_LABELS,
  FAILURE_STAGE_LABELS,
  GENERATION_MODE_LABELS,
  inputTypeLabel,
  PATCH_AXIS_LABELS,
} from "./generation-labels";
import { SafeSvgPreview } from "./safe-svg-preview";
import { formatMilliseconds } from "./shared";

const SEAMLESS_STATUS_LABELS: Readonly<
  Record<SeamlessDetailOut["status"], string>
> = {
  success: "성공",
  partial: "부분 성공",
  error: "오류",
};

function warningPresentation(warning: SeamlessWarningOut) {
  const count = warning.count.toLocaleString("ko-KR");
  const code = warning.code;
  const items = warning.items ?? [];
  if (code === "preview_unavailable") {
    return {
      title: `미리보기 ${count}개를 저장하지 못했습니다`,
      description:
        "디자인 SVG를 확인하고, 이미지 미리보기가 필요하면 생성을 다시 실행해 주세요.",
    };
  }
  if (code === "motif_layer_dropped") {
    const motifs = items.length > 0 ? items.join(", ") : "일부 모티프";
    return {
      title: `모티프 레이어 ${count}개를 제외했습니다`,
      description: `${motifs} 모티프를 카탈로그에서 사용할 수 없어 해당 레이어만 제거했습니다.`,
    };
  }
  if (code === "cmyk_gamut") {
    const colors = items.length > 0 ? ` (${items.join(", ")})` : "";
    return {
      title: `CMYK 색역 확인이 필요한 색상 ${count}개`,
      description: `화면용 RGB 색상${colors}이 인쇄 시 달라질 가능성이 있습니다. 생성 실패가 아니라 인쇄 전 색상 확인이 필요한 안내입니다.`,
    };
  }
  if (code === "spacing_snap") {
    return {
      title: `모티프 간격 ${count}건을 타일 경계에 맞췄습니다`,
      description:
        "경로를 따라 배치된 모티프가 반복 경계에서 자연스럽게 이어지도록 간격을 자동 보정했습니다. 생성 실패가 아닙니다.",
    };
  }
  if (code === "stripe_period_snap") {
    return {
      title: `스트라이프 주기 ${count}건을 타일 경계에 맞췄습니다`,
      description:
        "스트라이프가 반복 경계에서 자연스럽게 이어지도록 주기를 자동 보정했습니다. 생성 실패가 아닙니다.",
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
  vertex_embedding: "Vertex AI 임베딩",
  worker: "Worker",
};

const RESOLUTION_LABELS: Readonly<Record<string, string>> = {
  user_exact: "사용자 직접 선택",
  prompt_catalog: "프롬프트 카탈로그 재사용",
};

const MATCH_TYPE_LABELS: Readonly<Record<string, string>> = {
  exact_token: "주제·태그 일치",
  embedding: "벡터 유사도",
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
      <AdminCard title="디자인">
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
  const patchAxes = log.diagnostics.patch_axes ?? [];

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title="Seamless 로그 상세"
          description="서버가 다시 검사한 SVG만 격리된 이미지로 표시합니다."
        />
        <HStack gap="x2" wrap>
          <StatusBadge status={log.status} />
          <ActionButton
            variant="neutralOutline"
            size="small"
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            새로고침
          </ActionButton>
        </HStack>
      </HStack>

      {log.error_summary !== null && (
        <Callout
          tone="critical"
          title="생성 오류"
          description={log.error_summary}
        />
      )}

      <VStack gap="x4" alignItems="stretch">
        <Text as="h2" textStyle="title2">
          생성 결과
        </Text>
        {log.design === null ? (
          <ContentPlaceholder
            title="표시할 디자인이 없습니다"
            description="실패했거나 디자인 SVG가 기록되지 않은 생성입니다."
          />
        ) : (
          <Box maxWidth={480}>
            <AdminCard
              title="디자인"
              action={
                log.design.id ? (
                  <Badge tone="neutral">{log.design.id}</Badge>
                ) : undefined
              }
            >
              <SafeSvgPreview
                svg={log.design.svg}
                status={log.design.svg_status}
                alt="디자인 안전 미리보기"
              />
            </AdminCard>
          </Box>
        )}
      </VStack>

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
              label: "요청자",
              value: log.outcome.user_id ? (
                <Link to={`/customers/${log.outcome.user_id}`}>
                  {log.outcome.user_name ?? "고객 관리로 이동"}
                </Link>
              ) : (
                "확인 불가"
              ),
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

      {log.intent !== null && (
        <AdminCard
          title="생성 Intent"
          description="프롬프트 해석 후 검증·제약 적용·모티프 해석까지 끝난 엔진 입력입니다."
        >
          <TechnicalDetails title="Intent JSON" json={log.intent} />
        </AdminCard>
      )}

      <AdminCard title="성능">
        <DetailList
          items={[
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
              label: "수정한 구성 축",
              value:
                patchAxes.length === 0
                  ? "-"
                  : patchAxes
                      .map((axis) => PATCH_AXIS_LABELS[axis] ?? axis)
                      .join(" · "),
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
              value: `저작 ${formatMilliseconds(log.diagnostics.authoring_ms)} · 합성 ${formatMilliseconds(log.diagnostics.compose_ms)} · 렌더 ${formatMilliseconds(log.diagnostics.render_ms)}`,
            },
            {
              label: "실패 단계",
              value:
                FAILURE_STAGE_LABELS[log.failure_stage ?? ""] ??
                log.failure_stage ??
                "-",
            },
            {
              label: "실패 코드",
              value:
                FAILURE_CODE_LABELS[log.failure_code ?? ""] ??
                log.failure_code ??
                "-",
            },
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
          description="직접 선택 또는 프롬프트 카탈로그 검색으로 적용된 출처입니다."
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
                label: "이력에서 다시 활성화",
                value: log.outcome.reactivated ? "있음" : "없음",
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

      <AdminCard
        title="토큰 정산"
        description="생성 실행 ID와 연결된 토큰 원장 합계입니다."
      >
        <DetailList
          items={
            log.token_accounting.matched
              ? [
                  {
                    label: "차감",
                    value: `-${log.token_accounting.debited.toLocaleString("ko-KR")} 토큰`,
                  },
                  {
                    label: "환불",
                    value: `+${log.token_accounting.refunded.toLocaleString("ko-KR")} 토큰`,
                  },
                  {
                    label: "순변동",
                    value: `${log.token_accounting.net > 0 ? "+" : ""}${log.token_accounting.net.toLocaleString("ko-KR")} 토큰`,
                  },
                ]
              : [{ label: "원장 연결", value: "연결된 토큰 기록 없음" }]
          }
        />
      </AdminCard>

      {log.warning_groups.length > 0 && (
        <AdminCard
          title="생성 경고"
          description={`${log.warning_count.toLocaleString("ko-KR")}건의 경고를 ${log.warning_groups.length.toLocaleString("ko-KR")}개 원인으로 묶었습니다.`}
        >
          <VStack gap="x3" alignItems="stretch">
            {log.warning_groups.map((warning) => {
              const presentation = warningPresentation(warning);
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

      <Text textStyle="bodySm">
        <Link to="/seamless-logs">Seamless 로그 목록으로 돌아가기</Link>
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
          token_accounting: log.token_accounting,
          has_intent: log.intent !== null,
          seed: log.seed,
          engine_version: log.engine_version,
          registry_version: log.registry_version,
          design: log.design && {
            design_id: log.design.id,
            layout_id: log.design.layout_id,
            colorway_id: log.design.colorway_id,
            source_fidelity: log.design.source_fidelity,
            seed: log.design.seed,
            svg_status: log.design.svg_status,
          },
        }}
      />
    </VStack>
  );
}

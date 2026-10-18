import type {
  SeamlessDetailOut,
  SeamlessWarningOut,
} from "@essesion/api-client";
import { getAdminSeamlessLogOptions } from "@essesion/api-client/query";
import {
  ActionButton,
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

import { formatDateTime } from "../../shared/lib/format";
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
      description: `${motifs} 모티프를 카탈로그에서 쓸 수 없어 그 레이어만 제외했습니다.`,
    };
  }
  if (code === "cmyk_gamut") {
    const colors = items.length > 0 ? ` (${items.join(", ")})` : "";
    return {
      title: `CMYK 색역 확인이 필요한 색상 ${count}개`,
      description: `화면용 RGB 색상${colors}은 인쇄하면 달라질 수 있습니다. 인쇄 전에 색상을 확인해 주세요.`,
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
    description: "기술 정보의 요청 ID로 워커 로그를 확인해 주세요.",
  };
}

function SeamlessDetailLoading() {
  return (
    <VStack gap="x6" alignItems="stretch" aria-busy="true">
      <RouteHeading
        title="디자인 렌더 로그 상세"
        description="생성 결과·성능·진단 정보입니다."
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
          title="디자인 렌더 로그 상세"
          description="생성 결과·성능·진단 정보입니다."
        />
        <ContentPlaceholder
          title="디자인 렌더 로그를 불러오지 못했습니다"
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
          title="디자인 렌더 로그 상세"
          description="생성 결과·성능·진단 정보입니다."
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
              label: "요청자",
              value: log.outcome.user_id ? (
                <Link to={`/customers/${log.outcome.user_id}`}>
                  {log.outcome.user_name ?? "고객 정보 보기"}
                </Link>
              ) : (
                "확인 불가"
              ),
            },
            { label: "생성 시각", value: formatDateTime(log.created_at) },
          ]}
        />
      </AdminCard>

      {log.intent !== null && (
        <AdminCard
          title="디자인 의도"
          description="검증·제약 적용까지 끝난 엔진 입력입니다."
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
        description="검증·합성 결과를 단계별로 표시합니다."
      >
        <DetailList
          items={[
            {
              label: "생성 방식",
              value: GENERATION_MODE_LABELS[log.diagnostics.mode ?? ""] ?? "-",
            },
            {
              label: "단계별 시간",
              value: `합성 ${formatMilliseconds(log.diagnostics.compose_ms)} · 렌더 ${formatMilliseconds(log.diagnostics.render_ms)}`,
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
          ]}
        />
      </AdminCard>

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
        <Link to="/seamless-logs">디자인 렌더 로그 목록으로 돌아가기</Link>
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

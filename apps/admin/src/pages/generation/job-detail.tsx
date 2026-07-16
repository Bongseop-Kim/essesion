import type { GenerationJobDetailOut } from "@essesion/api-client";
import { getAdminGenerationJobOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  Box,
  Callout,
  ContentPlaceholder,
  HStack,
  ImageFrame,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { formatDateTime } from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { type DetailItem, DetailList } from "../../shared/ui/detail-list";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";
import { TechnicalDetails } from "../../shared/ui/technical-details";

function kindLabel(kind: "finalize" | "export") {
  return kind === "finalize" ? "원단 최종화" : "파일 내보내기";
}

const JOB_STATUS_LABELS: Readonly<
  Record<GenerationJobDetailOut["status"], string>
> = {
  queued: "대기",
  processing: "처리 중",
  succeeded: "성공",
  failed: "실패",
};

const PRODUCTION_METHOD_LABELS: Readonly<Record<string, string>> = {
  print: "날염",
  yarn_dyed: "선염",
};

const WEAVE_LABELS: Readonly<Record<string, string>> = {
  check: "체크",
  herringbone: "헤링본",
  jacquard: "자카드",
  pindot: "핀도트",
  plain: "평직",
  solid: "솔리드",
  "twill-0": "직선 트윌",
  "twill-45": "사선 트윌",
};

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function formatStrength(value: number) {
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function parameterSummaryItems(
  summary: GenerationJobDetailOut["parameter_summary"],
) {
  const items: DetailItem[] = [
    {
      label: "디자인 의도",
      value:
        summary.has_intent === true
          ? "포함"
          : summary.has_intent === false
            ? "없음"
            : "확인되지 않음",
    },
  ];
  const dpi = finiteNumber(summary.dpi);
  const productionMethod = nonEmptyString(summary.production_method);
  const weave = nonEmptyString(summary.weave);
  const textureStrength = finiteNumber(summary.texture_strength);
  const reliefStrength = finiteNumber(summary.relief_strength);

  if (dpi !== undefined)
    items.push({ label: "출력 해상도", value: `${dpi} DPI` });
  if (productionMethod !== undefined) {
    items.push({
      label: "제작 방식",
      value: PRODUCTION_METHOD_LABELS[productionMethod] ?? "기타 제작 방식",
    });
  }
  if (weave !== undefined) {
    items.push({
      label: "원단 짜임",
      value: WEAVE_LABELS[weave] ?? "기타 짜임",
    });
  }
  if (textureStrength !== undefined) {
    items.push({
      label: "질감 강도",
      value: formatStrength(textureStrength),
    });
  }
  if (reliefStrength !== undefined) {
    items.push({
      label: "입체감 강도",
      value: formatStrength(reliefStrength),
    });
  }
  return items;
}

function duration(start: string, end: string) {
  const elapsed = new Date(end).valueOf() - new Date(start).valueOf();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "-";
  if (elapsed < 1_000) return `${elapsed}ms`;
  if (elapsed < 60_000) return `${(elapsed / 1_000).toFixed(1)}초`;
  return `${(elapsed / 60_000).toFixed(1)}분`;
}

function JobDetailLoading() {
  return (
    <VStack gap="x6" alignItems="stretch" aria-busy="true">
      <RouteHeading
        title="생성 작업 상세"
        description="작업 단계와 시도·실패·결과 객체 상태를 확인합니다."
      />
      <AdminCard title="작업 정보">
        <VStack gap="x3" alignItems="stretch">
          <Skeleton preset="title" />
          <Skeleton preset="line" />
          <Skeleton preset="line-medium" />
        </VStack>
      </AdminCard>
      <AdminCard title="입력 요약">
        <VStack gap="x3" alignItems="stretch">
          <Skeleton preset="line-medium" />
          <Skeleton preset="line" />
          <Skeleton preset="title" />
        </VStack>
      </AdminCard>
      <AdminCard title="결과">
        <Skeleton preset="result" />
      </AdminCard>
    </VStack>
  );
}

export function GenerationJobDetailPage() {
  const { jobId = "" } = useParams();
  const query = useQuery({
    ...getAdminGenerationJobOptions({ path: { job_id: jobId } }),
    enabled: jobId !== "",
  });

  if (query.isLoading) return <JobDetailLoading />;

  if (query.isError || query.data === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading
          title="생성 작업 상세"
          description="작업 단계와 시도·실패·결과 객체 상태를 확인합니다."
        />
        <ContentPlaceholder
          title="생성 작업을 불러오지 못했습니다"
          description="작업 ID를 확인하거나 다시 시도해 주세요."
          action={
            <ActionButton onClick={() => void query.refetch()}>
              다시 시도
            </ActionButton>
          }
        />
      </VStack>
    );
  }

  const job = query.data;

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title="생성 작업 상세"
          description="민감 입력과 객체 키를 제외한 운영 projection만 표시합니다."
        />
        <StatusBadge status={job.status} />
      </HStack>

      {job.error_summary !== null && (
        <Callout
          tone="critical"
          title="작업 실패"
          description={job.error_summary}
        />
      )}

      <AdminCard title="작업 정보">
        <DetailList
          items={[
            { label: "상태", value: JOB_STATUS_LABELS[job.status] },
            { label: "단계", value: kindLabel(job.kind) },
            { label: "시도 횟수", value: `${job.attempts}회` },
            {
              label: "결과 객체",
              value: job.result_available ? "기록됨" : "없음",
            },
            { label: "생성 시각", value: formatDateTime(job.created_at) },
            { label: "수정 시각", value: formatDateTime(job.updated_at) },
            {
              label: "처리 시간",
              value: duration(job.created_at, job.updated_at),
            },
          ]}
        />
      </AdminCard>

      <AdminCard
        title="입력 요약"
        description="작업에 적용된 생성 조건을 운영자가 확인하기 쉬운 형태로 표시합니다."
      >
        <DetailList items={parameterSummaryItems(job.parameter_summary)} />
      </AdminCard>

      <AdminCard
        title="결과"
        description="공개 content-hash 결과만 표시합니다."
      >
        {!job.result_available ? (
          <Callout
            tone="neutral"
            title="결과 객체 없음"
            description="작업이 완료되지 않았거나 결과가 기록되지 않았습니다."
          />
        ) : job.result_url === null ? (
          <Callout
            tone="warning"
            title="결과 미리보기 불가"
            description="결과 기록은 있지만 공개 가능한 content-hash URL이 없습니다."
          />
        ) : (
          <VStack gap="x3" alignItems="stretch">
            <Box maxWidth={640}>
              <ImageFrame
                src={job.result_url}
                alt="생성 작업 결과"
                ratio={4 / 3}
                fit="contain"
                stroke
              />
            </Box>
            <Text textStyle="bodySm">
              <a href={job.result_url} target="_blank" rel="noreferrer">
                새 탭에서 결과 열기
              </a>
            </Text>
          </VStack>
        )}
      </AdminCard>

      <Text textStyle="bodySm">
        <Link to="/generation-logs?tab=jobs">생성 작업 목록으로 돌아가기</Link>
      </Text>

      <TechnicalDetails
        json={{
          job_id: job.id,
          request_id: job.request_id,
          session_id: job.session_id,
          owner_reference: job.owner_reference,
          parameter_summary: job.parameter_summary,
        }}
      />
    </VStack>
  );
}

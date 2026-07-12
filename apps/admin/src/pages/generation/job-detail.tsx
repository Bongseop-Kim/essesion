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

import { formatDateTime, formatIdentifier } from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { DetailList } from "../../shared/ui/detail-list";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";

function kindLabel(kind: "finalize" | "export") {
  return kind === "finalize" ? "원단 최종화" : "파일 내보내기";
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
          <Skeleton width="60%" height={24} />
          <Skeleton width="100%" height={20} />
          <Skeleton width="80%" height={20} />
        </VStack>
      </AdminCard>
      <AdminCard title="파라미터 요약">
        <Skeleton width="100%" height={120} />
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
            { label: "작업 ID", value: job.id },
            { label: "상태", value: job.status },
            { label: "단계", value: kindLabel(job.kind) },
            { label: "시도 횟수", value: `${job.attempts}회` },
            { label: "소유자", value: job.owner_reference },
            { label: "요청 ID", value: formatIdentifier(job.request_id) },
            { label: "디자인 세션", value: formatIdentifier(job.session_id) },
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
        title="파라미터 요약"
        description="서버가 허용한 수치·분류와 intent 존재 여부만 표시합니다."
      >
        <Box
          as="pre"
          bg="bg.neutral-weak"
          borderRadius="r2"
          p="x4"
          overflow="auto"
          className="max-h-96 whitespace-pre-wrap break-words"
        >
          <Text as="code" textStyle="caption">
            {JSON.stringify(job.parameter_summary, null, 2)}
          </Text>
        </Box>
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
                alt={`생성 작업 ${job.id} 결과`}
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
    </VStack>
  );
}

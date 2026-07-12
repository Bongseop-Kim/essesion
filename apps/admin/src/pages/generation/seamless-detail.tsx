import type { SafeCandidateOut } from "@essesion/api-client";
import {
  createAdminSeamlessReferenceImageReadUrlMutation,
  getAdminSeamlessLogOptions,
} from "@essesion/api-client/query";
import {
  ActionButton,
  Badge,
  Box,
  Callout,
  ContentPlaceholder,
  Grid,
  HStack,
  ImageFrame,
  Skeleton,
  Tag,
  TagGroup,
  Text,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { formatDateTime, formatIdentifier } from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { DetailList } from "../../shared/ui/detail-list";
import { RouteHeading } from "../../shared/ui/route-heading";
import { SafeSvgPreview } from "./safe-svg-preview";

function formatMilliseconds(value: number | null) {
  return value === null
    ? "-"
    : `${Math.round(value).toLocaleString("ko-KR")}ms`;
}

function formatBytes(value: number | null) {
  if (value === null) return "-";
  if (value < 1_024) return `${value.toLocaleString("ko-KR")}B`;
  return `${(value / 1_024).toFixed(1)}KB`;
}

function SeamlessStatusBadge({ status }: { status: string }) {
  const tone =
    status === "success"
      ? "positive"
      : status === "error"
        ? "critical"
        : "warning";
  return <Badge tone={tone}>{status}</Badge>;
}

function CandidateCard({
  candidate,
  index,
}: {
  candidate: SafeCandidateOut;
  index: number;
}) {
  const label = candidate.id ?? `후보 ${index + 1}`;
  return (
    <AdminCard title={label} description={`SVG 상태: ${candidate.svg_status}`}>
      <VStack gap="x4" alignItems="stretch">
        <SafeSvgPreview
          svg={candidate.svg}
          status={candidate.svg_status}
          alt={`${label} 안전 미리보기`}
        />
        <DetailList
          items={[
            {
              label: "디자인 인덱스",
              value: formatIdentifier(candidate.design_index),
            },
            {
              label: "레이아웃",
              value: formatIdentifier(candidate.layout_id),
            },
            {
              label: "컬러웨이",
              value: formatIdentifier(candidate.colorway_id),
            },
            {
              label: "소스 충실도",
              value: formatIdentifier(candidate.source_fidelity),
            },
            { label: "seed", value: formatIdentifier(candidate.seed) },
          ]}
        />
      </VStack>
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
        <SeamlessStatusBadge status={log.status} />
      </HStack>

      {log.error_summary !== null && (
        <Callout
          tone="critical"
          title={log.error_type ?? "생성 오류"}
          description={log.error_summary}
        />
      )}

      <AdminCard title="로그 정보">
        <DetailList
          items={[
            { label: "로그 ID", value: log.id },
            { label: "요청 ID", value: formatIdentifier(log.request_id) },
            { label: "상태", value: log.status },
            { label: "입력 유형", value: log.input_type },
            { label: "seed", value: formatIdentifier(log.seed) },
            {
              label: "prompt 보유",
              value: log.has_prompt ? "있음 (내용 비공개)" : "없음",
            },
            {
              label: "참고 이미지",
              value: log.has_reference_image
                ? `있음 (${formatBytes(log.reference_image_bytes)})`
                : "없음",
            },
            { label: "생성 시각", value: formatDateTime(log.created_at) },
            {
              label: "엔진 버전",
              value: formatIdentifier(log.engine_version),
            },
            {
              label: "레지스트리 버전",
              value: formatIdentifier(log.registry_version),
            },
          ]}
        />
      </AdminCard>

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

      {log.warning_codes.length > 0 && (
        <AdminCard title="경고 코드">
          <TagGroup>
            {log.warning_codes.map((warning) => (
              <Tag key={warning}>{warning}</Tag>
            ))}
          </TagGroup>
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
          <Grid columns={{ base: 1, md: 2 }} gap="x4">
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
    </VStack>
  );
}

import { getAdminMotifOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  ContentPlaceholder,
  Grid,
  HStack,
  Skeleton,
  Tag,
  TagGroup,
  Text,
  VStack,
} from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";

import { formatDateTime, formatIdentifier } from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { DetailList } from "../../shared/ui/detail-list";
import { RouteHeading } from "../../shared/ui/route-heading";
import { SafeSvgPreview } from "../generation/safe-svg-preview";

export function motifPreviewDocument(
  symbol: string | null,
  bbox: readonly number[],
) {
  if (symbol === null) return null;
  const trimmed = symbol.trim();
  if (trimmed.startsWith("<svg")) return trimmed;
  if (!/^<symbol(?:\s|>)/.test(trimmed) || !trimmed.endsWith("</symbol>")) {
    return trimmed;
  }
  const [minX = 0, minY = 0, maxX = 100, maxY = 100] = bbox;
  const hasUsableBbox =
    bbox.length === 4 &&
    bbox.every(Number.isFinite) &&
    maxX > minX &&
    maxY > minY;
  const viewBox = hasUsableBbox
    ? `${minX} ${minY} ${maxX - minX} ${maxY - minY}`
    : "0 0 100 100";
  return trimmed
    .replace(
      /^<symbol\b/,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"`,
    )
    .replace(/<\/symbol>$/, "</svg>");
}

function MotifDetailLoading() {
  return (
    <VStack gap="x6" alignItems="stretch" aria-busy="true">
      <RouteHeading
        title="Motif 상세"
        description="Motif 메타데이터와 미리보기를 불러오고 있습니다."
      />
      <AdminCard title="Motif 상세">
        <Grid columns={{ base: 1, md: 2 }} gap="x4">
          <Skeleton width="100%" height={320} />
          <VStack gap="x3" alignItems="stretch">
            <Skeleton width="70%" height={24} />
            <Skeleton width="100%" height={20} />
            <Skeleton width="80%" height={20} />
          </VStack>
        </Grid>
      </AdminCard>
    </VStack>
  );
}

export function MotifDetailPage() {
  const { motifId = "" } = useParams();
  const navigate = useNavigate();
  const query = useQuery({
    ...getAdminMotifOptions({ path: { motif_id: motifId } }),
    enabled: motifId !== "",
  });

  if (query.isLoading) return <MotifDetailLoading />;

  if (query.isError || query.data === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading
          title="Motif 상세"
          description="Motif 메타데이터와 서버 안전성 검사를 통과한 SVG를 확인합니다."
        />
        <ContentPlaceholder
          title="Motif 상세를 불러오지 못했습니다"
          description="Motif ID를 확인하거나 다시 시도해 주세요."
          action={
            <ActionButton onClick={() => void query.refetch()}>
              다시 시도
            </ActionButton>
          }
        />
      </VStack>
    );
  }

  const motif = query.data;
  const preview =
    motif.svg_status === "safe"
      ? motifPreviewDocument(motif.symbol, motif.bbox)
      : motif.symbol;

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title={motif.subject ?? motif.id}
          description={`Motif ID: ${motif.id} · SVG 상태: ${motif.svg_status}`}
        />
        <ActionButton variant="ghost" onClick={() => navigate("/motifs")}>
          목록으로
        </ActionButton>
      </HStack>

      <AdminCard title="Motif 상세">
        <Grid columns={{ base: 1, md: 2 }} gap="x5">
          <SafeSvgPreview
            svg={preview}
            status={motif.svg_status}
            alt={`${motif.subject ?? motif.id} Motif 안전 미리보기`}
          />
          <VStack gap="x4" alignItems="stretch">
            <DetailList
              items={[
                { label: "주제", value: formatIdentifier(motif.subject) },
                { label: "범위", value: formatIdentifier(motif.scope) },
                { label: "뷰", value: formatIdentifier(motif.view) },
                { label: "표현", value: formatIdentifier(motif.expression) },
                { label: "스타일", value: formatIdentifier(motif.style) },
                { label: "소스", value: motif.source },
                {
                  label: "품질",
                  value:
                    motif.quality === null ? "-" : motif.quality.toFixed(3),
                },
                {
                  label: "변형 그룹",
                  value: formatIdentifier(motif.variant_group),
                },
                { label: "색상 슬롯", value: `${motif.color_slot_count}개` },
                { label: "생성일", value: formatDateTime(motif.created_at) },
                {
                  label: "bbox",
                  value: motif.bbox.length === 4 ? motif.bbox.join(", ") : "-",
                },
                {
                  label: "anchor",
                  value:
                    motif.anchor.length === 2 ? motif.anchor.join(", ") : "-",
                },
              ]}
            />
            {motif.description !== null && (
              <VStack gap="x1">
                <Text textStyle="caption" color="fg.neutral-muted">
                  설명
                </Text>
                <Text textStyle="bodySm">{motif.description}</Text>
              </VStack>
            )}
            {motif.tags.length > 0 && (
              <VStack gap="x1">
                <Text textStyle="caption" color="fg.neutral-muted">
                  태그
                </Text>
                <TagGroup>
                  {motif.tags.map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                </TagGroup>
              </VStack>
            )}
            {motif.color_slots.length > 0 && (
              <VStack gap="x1">
                <Text textStyle="caption" color="fg.neutral-muted">
                  색상 슬롯 키
                </Text>
                <TagGroup>
                  {motif.color_slots.map((slot) => (
                    <Tag key={slot}>{slot}</Tag>
                  ))}
                </TagGroup>
              </VStack>
            )}
          </VStack>
        </Grid>
      </AdminCard>
    </VStack>
  );
}

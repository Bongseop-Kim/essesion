import type { MotifDetailOut } from "@essesion/api-client";
import {
  getAdminMotifOptions,
  getAdminMotifQueryKey,
  listAdminMotifsQueryKey,
  reviewAdminMotifMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Callout,
  ContentPlaceholder,
  Grid,
  HStack,
  Skeleton,
  snackbar,
  Tag,
  TagGroup,
  Text,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MouseEvent } from "react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";

import {
  formatDateTime,
  formatIdentifier,
  getErrorMessage,
} from "../../shared/lib/format";
import { useAdminSession } from "../../shared/session/admin-session";
import { AdminCard } from "../../shared/ui/admin-card";
import { DetailList } from "../../shared/ui/detail-list";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";
import { SafeSvgPreview } from "../generation/safe-svg-preview";

type ReviewStatus = "approved" | "rejected";

const REVIEW_LABELS: Record<ReviewStatus, string> = {
  approved: "승인",
  rejected: "거절",
};

export function motifPreviewDocument(
  symbol: string | null,
  bbox: readonly number[],
) {
  if (symbol === null) return null;
  const trimmed = symbol.trim();
  if (!/^<symbol(?:\s|>)/.test(trimmed) || !trimmed.endsWith("</symbol>")) {
    return trimmed;
  }
  const [minX = 0, minY = 0, maxX = 100, maxY = 100] = bbox;
  const hasUsableBbox =
    bbox.length === 4 &&
    bbox.every(Number.isFinite) &&
    maxX > minX &&
    maxY > minY;
  const [bx, by, bw, bh] = hasUsableBbox
    ? [minX, minY, maxX - minX, maxY - minY]
    : [0, 0, 100, 100];
  // Pad the viewBox so geometry that slightly overflows its declared bbox (Bézier extrema the
  // motif bbox undercounts) isn't clipped at the edges. Display-only — motif identity is unchanged.
  const pad = 0.06;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const vw = round(bw * (1 + pad * 2));
  const vh = round(bh * (1 + pad * 2));
  const viewBox = `${round(bx - bw * pad)} ${round(by - bh * pad)} ${vw} ${vh}`;
  const svg = trimmed
    .replace(
      /^<symbol\b/,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"`,
    )
    .replace(/<\/symbol>$/, "</svg>");
  return svg;
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

function MotifReviewActions({
  motif,
  onUpdated,
}: {
  motif: MotifDetailOut;
  onUpdated: (value: MotifDetailOut) => void;
}) {
  const queryClient = useQueryClient();
  const { state } = useAdminSession();
  const canReview =
    state.status === "authenticated" && state.session.role === "admin";
  const [nextStatus, setNextStatus] = useState<ReviewStatus>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const mutation = useMutation({
    ...reviewAdminMotifMutation(),
    onSuccess: async (value) => {
      const label = value.status === "approved" ? "승인" : "거절";
      snackbar(`Motif를 ${label} 처리했습니다.`);
      onUpdated(value);
      setNextStatus(undefined);
      await queryClient.invalidateQueries({
        queryKey: listAdminMotifsQueryKey(),
      });
    },
  });

  if (!canReview) {
    return (
      <AdminCard title="카탈로그 검토">
        <Text textStyle="bodySm" color="fg.neutral-muted">
          manager 역할은 검토 상태를 조회할 수 있지만 변경할 수 없습니다.
        </Text>
      </AdminCard>
    );
  }

  const choose = (status: ReviewStatus) => {
    mutation.reset();
    setNextStatus(status);
    setConfirmOpen(true);
  };
  const submit = (event: MouseEvent<HTMLButtonElement>) => {
    // AlertDialog는 preventDefault가 없으면 클릭 즉시 닫힌다 — mutation이 끝날 때까지 열어둔다.
    event.preventDefault();
    if (nextStatus === undefined || mutation.isPending) return;
    mutation.mutate(
      {
        path: { motif_id: motif.id },
        body: { status: nextStatus },
      },
      { onSettled: () => setConfirmOpen(false) },
    );
  };

  return (
    <AdminCard
      title="카탈로그 검토"
      description="승인한 Motif만 다른 사용자의 검색·grounding·variant 재사용 풀에 반영됩니다."
    >
      <VStack gap="x3" alignItems="stretch">
        <HStack gap="x2" wrap>
          <ActionButton
            variant="criticalSolid"
            disabled={mutation.isPending || motif.status === "rejected"}
            onClick={() => choose("rejected")}
          >
            거절
          </ActionButton>
          <ActionButton
            disabled={mutation.isPending || motif.status === "approved"}
            onClick={() => choose("approved")}
          >
            승인
          </ActionButton>
        </HStack>
        {mutation.isError && (
          <Callout
            role="alert"
            tone="critical"
            title="Motif 검토 상태를 변경하지 못했습니다"
            description={getErrorMessage(
              mutation.error,
              "현재 상태를 새로고침한 뒤 다시 시도해 주세요.",
            )}
          />
        )}
      </VStack>
      <AlertDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`이 Motif를 ${nextStatus ? REVIEW_LABELS[nextStatus] : "처리"}할까요?`}
        description={
          nextStatus === "approved"
            ? "승인 직후 공개 카탈로그 검색과 재사용 풀에 반영됩니다."
            : "거절하면 공개 카탈로그에서 제외되며 기존 세션의 직접 참조는 유지됩니다."
        }
        primaryActionProps={{
          children: nextStatus ? REVIEW_LABELS[nextStatus] : "확인",
          variant: nextStatus === "rejected" ? "criticalSolid" : "brandSolid",
          loading: mutation.isPending,
          onClick: submit,
        }}
        secondaryActionProps={{
          children: "취소",
          disabled: mutation.isPending,
        }}
      />
    </AdminCard>
  );
}

export function MotifDetailPage() {
  const { motifId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const requestOptions = { path: { motif_id: motifId } };
  const query = useQuery({
    ...getAdminMotifOptions(requestOptions),
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
        <HStack gap="x2">
          <StatusBadge status={motif.status} />
          <ActionButton variant="ghost" onClick={() => navigate("/motifs")}>
            목록으로
          </ActionButton>
        </HStack>
      </HStack>

      <MotifReviewActions
        motif={motif}
        onUpdated={(value) =>
          queryClient.setQueryData(getAdminMotifQueryKey(requestOptions), value)
        }
      />

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
                { label: "검토 상태", value: motif.status },
                {
                  label: "검토 시각",
                  value:
                    motif.reviewed_at === null
                      ? "-"
                      : formatDateTime(motif.reviewed_at),
                },
                {
                  label: "변형 그룹",
                  value: formatIdentifier(motif.variant_group),
                },
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
          </VStack>
        </Grid>
      </AdminCard>
    </VStack>
  );
}

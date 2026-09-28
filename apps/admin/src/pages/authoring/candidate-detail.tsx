import type { AuthoringCandidateDetailOut } from "@essesion/api-client";
import {
  decideAuthoringCandidateMutation,
  getAuthoringCandidateOptions,
  getAuthoringCandidateQueryKey,
  listAuthoringCandidatesQueryKey,
  listAuthoringExamplesQueryKey,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Callout,
  ContentPlaceholder,
  Grid,
  HStack,
  snackbar,
  Tag,
  TagGroup,
  Text,
  TextAreaField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import {
  formatDateTime,
  formatIdentifier,
  getErrorMessage,
} from "../../shared/lib/format";
import { useAdminSession } from "../../shared/session/admin-session";
import { AdminCard } from "../../shared/ui/admin-card";
import { DetailList } from "../../shared/ui/detail-list";
import { RouteHeading } from "../../shared/ui/route-heading";
import { formatStatus, StatusBadge } from "../../shared/ui/status-badge";
import { TechnicalDetails } from "../../shared/ui/technical-details";
import { SafeSvgPreview } from "../generation/safe-svg-preview";

type Decision = "hold" | "reject" | "approve";

const DECISION_LABELS: Record<Decision, string> = {
  hold: "보류",
  reject: "거절",
  approve: "승인",
};

function CandidateActions({
  candidate,
  onUpdated,
}: {
  candidate: AuthoringCandidateDetailOut;
  onUpdated: (value: AuthoringCandidateDetailOut) => void;
}) {
  const queryClient = useQueryClient();
  const { state } = useAdminSession();
  const canEdit =
    state.status === "authenticated" && state.session.role === "admin";
  const [decision, setDecision] = useState<Decision>();
  const [reason, setReason] = useState("");
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const mutation = useMutation({
    ...decideAuthoringCandidateMutation(),
    onSuccess: async (value) => {
      snackbar(
        `few-shot 후보를 ${DECISION_LABELS[decision ?? "hold"]}했습니다.`,
      );
      onUpdated(value);
      setDecision(undefined);
      setReason("");
      setOperationId(crypto.randomUUID());
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: listAuthoringCandidatesQueryKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: listAuthoringExamplesQueryKey(),
        }),
      ]);
    },
  });

  if (!canEdit) {
    return (
      <AdminCard title="검토 결정">
        <Text textStyle="bodySm" color="fg.neutral-muted">
          매니저는 검토 이력을 조회만 할 수 있습니다.
        </Text>
      </AdminCard>
    );
  }
  if (candidate.status !== "pending" && candidate.status !== "hold") {
    return (
      <AdminCard title="검토 결정">
        <Text textStyle="bodySm" color="fg.neutral-muted">
          검토를 마친 후보라 상태를 더 바꿀 수 없습니다.
        </Text>
      </AdminCard>
    );
  }

  const choose = (next: Decision) => {
    mutation.reset();
    setDecision(next);
    setReason("");
    setOperationId(crypto.randomUUID());
  };
  const submit = () => {
    if (decision === undefined || reason.trim().length < 3) return;
    mutation.mutate({
      path: { candidate_id: candidate.id },
      body: {
        operation_id: operationId,
        decision,
        reason: reason.trim(),
        expected_review_version: candidate.review_version,
      },
    });
  };

  return (
    <AdminCard
      title="검토 결정"
      description="승인하면 중복을 다시 검사한 뒤 바로 few-shot 시범으로 등록합니다."
    >
      <VStack gap="x4" alignItems="stretch">
        <HStack gap="x2" wrap>
          {candidate.status === "pending" && (
            <ActionButton
              variant="neutralOutline"
              disabled={mutation.isPending}
              onClick={() => choose("hold")}
            >
              보류
            </ActionButton>
          )}
          <ActionButton
            variant="criticalSolid"
            disabled={mutation.isPending}
            onClick={() => choose("reject")}
          >
            거절
          </ActionButton>
          <ActionButton
            disabled={mutation.isPending}
            onClick={() => choose("approve")}
          >
            승인
          </ActionButton>
        </HStack>
        {decision !== undefined && (
          <VStack gap="x3" alignItems="stretch">
            <TextAreaField
              label={`${DECISION_LABELS[decision]} 사유`}
              required
              maxLength={500}
              value={reason}
              disabled={mutation.isPending}
              errorMessage={
                reason !== "" && reason.trim().length < 3
                  ? "3자 이상 입력해 주세요."
                  : undefined
              }
              onChange={(event) => {
                if (mutation.isError) {
                  mutation.reset();
                  setOperationId(crypto.randomUUID());
                }
                setReason(event.currentTarget.value);
              }}
            />
            <HStack gap="x2">
              <ActionButton
                disabled={reason.trim().length < 3}
                loading={mutation.isPending}
                onClick={() => setConfirmOpen(true)}
              >
                {DECISION_LABELS[decision]}하기
              </ActionButton>
              <ActionButton
                variant="ghost"
                disabled={mutation.isPending}
                onClick={() => setDecision(undefined)}
              >
                취소
              </ActionButton>
            </HStack>
          </VStack>
        )}
        {mutation.isError && (
          <Callout
            role="alert"
            tone="critical"
            title="검토 결정을 저장하지 못했습니다"
            description={getErrorMessage(
              mutation.error,
              "후보 상태와 중복 검사 결과를 새로고침한 뒤 다시 시도해 주세요.",
            )}
          />
        )}
      </VStack>
      <AlertDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`이 few-shot 후보를 ${decision ? DECISION_LABELS[decision] : "처리"}할까요?`}
        description={
          decision === "approve"
            ? "승인 직후 이 시범은 few-shot 검색 대상이 됩니다."
            : `입력한 사유와 함께 ${decision ? DECISION_LABELS[decision] : "검토"} 상태가 기록됩니다.`
        }
        primaryActionProps={{
          children: decision ? DECISION_LABELS[decision] : "확인",
          variant: decision === "reject" ? "criticalSolid" : "brandSolid",
          onClick: submit,
        }}
        secondaryActionProps={{ children: "취소" }}
      />
    </AdminCard>
  );
}

export function AuthoringCandidateDetailPage() {
  const { candidateId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const requestOptions = {
    path: { candidate_id: candidateId },
  };
  const options = getAuthoringCandidateOptions(requestOptions);
  const query = useQuery({ ...options, enabled: candidateId !== "" });

  if (query.isLoading) {
    return (
      <VStack gap="x6" alignItems="stretch" aria-busy="true">
        <RouteHeading
          title="few-shot 후보 상세"
          description="검토 데이터와 생성 미리보기를 불러오고 있습니다."
        />
        <ContentPlaceholder title="few-shot 후보를 불러오고 있습니다" />
      </VStack>
    );
  }
  if (query.isError || query.data === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading title="few-shot 후보 상세" />
        <ContentPlaceholder
          title="few-shot 후보를 불러오지 못했습니다"
          action={
            <ActionButton onClick={() => void query.refetch()}>
              다시 시도
            </ActionButton>
          }
        />
      </VStack>
    );
  }

  const candidate = query.data;
  const updateCandidate = (value: AuthoringCandidateDetailOut) => {
    queryClient.setQueryData(
      getAuthoringCandidateQueryKey(requestOptions),
      value,
    );
  };
  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title="few-shot 후보 상세"
          description={`후보 ID: ${candidate.id}`}
        />
        <HStack gap="x2">
          <StatusBadge status={candidate.status} />
          <ActionButton
            variant="ghost"
            onClick={() => navigate("/few-shot-candidates")}
          >
            목록으로
          </ActionButton>
        </HStack>
      </HStack>

      <CandidateActions candidate={candidate} onUpdated={updateCandidate} />

      <AdminCard title="생성 결과와 요청">
        <Grid columns={{ base: 1, md: 2 }} gap="x5">
          <SafeSvgPreview
            svg={candidate.preview_svg}
            status={candidate.preview_status}
            alt="few-shot 후보 SVG 안전 미리보기"
          />
          <VStack gap="x4" alignItems="stretch">
            <VStack gap="x1" alignItems="stretch">
              <Text textStyle="caption" color="fg.neutral-muted">
                원본 사용자 요청
              </Text>
              <Text textStyle="bodySm" className="whitespace-pre-wrap">
                {candidate.retrieval_text}
              </Text>
            </VStack>
            {candidate.source_generation_log_id !== null && (
              <Link to={`/seamless-logs/${candidate.source_generation_log_id}`}>
                원본 생성 로그 보기
              </Link>
            )}
            {candidate.tags.length > 0 && (
              <TagGroup>
                {candidate.tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </TagGroup>
            )}
          </VStack>
        </Grid>
      </AdminCard>

      <AdminCard title="선별·중복 정보">
        <DetailList
          items={[
            { label: "상태", value: formatStatus(candidate.status) },
            { label: "구조", value: candidate.family },
            { label: "모티프 수", value: `${candidate.motif_count}개` },
            { label: "Plan 계약", value: `v${candidate.contract_version}` },
            { label: "컴파일러 버전", value: candidate.compiler_revision },
            { label: "프롬프트 버전", value: candidate.prompt_revision },
            {
              label: "임베딩 모델",
              value: formatIdentifier(candidate.embedding_model),
            },
            {
              label: "최근접 대상",
              value:
                candidate.nearest_similarity === null
                  ? "없음"
                  : `${candidate.nearest_kind ?? "unknown"}:${candidate.nearest_id ?? "-"} (${candidate.nearest_similarity.toFixed(3)})`,
            },
            {
              label: "검토 사유",
              value: formatIdentifier(candidate.review_reason),
            },
            { label: "등록 시각", value: formatDateTime(candidate.created_at) },
            { label: "수정 시각", value: formatDateTime(candidate.updated_at) },
          ]}
        />
      </AdminCard>

      <TechnicalDetails
        title="Plan·선별 기술 정보"
        json={{
          plan: candidate.plan,
          structural_fingerprint: candidate.structural_fingerprint,
          source_digest: candidate.source_digest,
          source_key: candidate.source_key,
          rule_reasons: candidate.rule_reasons,
          review_version: candidate.review_version,
        }}
      />
    </VStack>
  );
}

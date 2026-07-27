import type { AuthoringExampleDetailOut } from "@essesion/api-client";
import {
  deleteAuthoringExampleMutation,
  getAuthoringExampleOptions,
  getAuthoringExampleQueryKey,
  listAuthoringExamplesQueryKey,
  setAuthoringExampleActivationMutation,
  updateAuthoringExampleMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Box,
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
import { useNavigate, useParams } from "react-router";

import { formatDateTime, getErrorMessage } from "../../shared/lib/format";
import { useAdminSession } from "../../shared/session/admin-session";
import { AdminCard } from "../../shared/ui/admin-card";
import { DetailList } from "../../shared/ui/detail-list";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";
import { TechnicalDetails } from "../../shared/ui/technical-details";
import {
  AuthoringExampleForm,
  type AuthoringExampleFormValue,
  planJsonText,
} from "./example-studio";
import { MotifPicker } from "./motif-picker";
import { PlanPreviewCard } from "./plan-preview";

/** 플랜이 참조하는 input 모티프 수 — 시드 예시는 motif_ids 없이 이 자리만 갖는다 */
function planInputMotifCount(plan: Record<string, unknown>): number {
  const motifs = plan.motifs;
  if (!Array.isArray(motifs)) return 0;
  return motifs.filter(
    (motif) =>
      typeof motif === "object" &&
      motif !== null &&
      (motif as { source?: unknown }).source === "input",
  ).length;
}

function ActivationAction({
  example,
  onUpdated,
}: {
  example: AuthoringExampleDetailOut;
  onUpdated: (value: AuthoringExampleDetailOut) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { state } = useAdminSession();
  const canEdit =
    state.status === "authenticated" && state.session.role === "admin";
  const targetActive = !example.active;
  const activationLabel =
    example.active_updated_at === null ? "활성화" : "재활성화";
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const mutation = useMutation({
    ...setAuthoringExampleActivationMutation(),
    onSuccess: async (value) => {
      snackbar(
        value.active
          ? "few-shot 시범을 활성화했습니다."
          : "few-shot 시범을 즉시 제외했습니다.",
      );
      onUpdated(value);
      await queryClient.invalidateQueries({
        queryKey: listAuthoringExamplesQueryKey(),
      });
    },
  });
  const deleteMutation = useMutation({
    ...deleteAuthoringExampleMutation(),
    onSuccess: async () => {
      snackbar("few-shot 시범을 삭제했습니다.");
      await queryClient.invalidateQueries({
        queryKey: listAuthoringExamplesQueryKey(),
      });
      navigate("/few-shot-examples");
    },
  });

  if (!canEdit) {
    return (
      <AdminCard title="few-shot 주입 상태">
        <Text textStyle="bodySm" color="fg.neutral-muted">
          manager 역할은 상태와 이력을 조회할 수 있지만 활성 상태는 변경할 수
          없습니다.
        </Text>
      </AdminCard>
    );
  }

  return (
    <AdminCard
      title="few-shot 주입 상태"
      description={
        example.active
          ? "비활성화하면 다음 검색부터 즉시 제외됩니다."
          : `${activationLabel}할 때 현재 계약·임베딩과 중복을 다시 확인합니다.`
      }
    >
      <VStack gap="x4" alignItems="stretch">
        {example.active && (
          <Callout
            tone="warning"
            title="비활성화는 즉시 적용됩니다"
            description="새 생성 요청의 few-shot 검색에서 이 시범이 바로 제외됩니다."
          />
        )}
        <HStack gap="x2">
          <ActionButton
            variant={example.active ? "criticalSolid" : "brandSolid"}
            loading={mutation.isPending}
            disabled={deleteMutation.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            {targetActive ? `시범 ${activationLabel}` : "시범 비활성화"}
          </ActionButton>
          {!example.active && (
            <ActionButton
              variant="criticalSolid"
              loading={deleteMutation.isPending}
              disabled={mutation.isPending}
              onClick={() => setDeleteOpen(true)}
            >
              시범 영구 삭제
            </ActionButton>
          )}
        </HStack>
        {mutation.isError && (
          <Callout
            role="alert"
            tone="critical"
            title="활성 상태를 변경하지 못했습니다"
            description={getErrorMessage(
              mutation.error,
              "최신 상태와 중복 검사 결과를 확인한 뒤 다시 시도해 주세요.",
            )}
          />
        )}
        {deleteMutation.isError && (
          <Callout
            role="alert"
            tone="critical"
            title="시범을 삭제하지 못했습니다"
            description={getErrorMessage(
              deleteMutation.error,
              "최신 상태를 확인한 뒤 다시 시도해 주세요.",
            )}
          />
        )}
      </VStack>
      <AlertDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={
          targetActive
            ? `이 시범을 ${activationLabel}할까요?`
            : "이 시범을 비활성화할까요?"
        }
        description={
          targetActive
            ? "검증을 통과하면 다음 검색부터 즉시 few-shot 대상이 됩니다."
            : "다음 few-shot 검색부터 즉시 제외되며 기록은 유지됩니다."
        }
        primaryActionProps={{
          children: targetActive ? activationLabel : "비활성화",
          variant: targetActive ? "brandSolid" : "criticalSolid",
          onClick: () =>
            mutation.mutate({
              path: { example_id: example.id },
              body: {
                operation_id: crypto.randomUUID(),
                active: targetActive,
                expected_updated_at: example.updated_at,
              },
            }),
        }}
        secondaryActionProps={{ children: "취소" }}
      />
      <AlertDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="이 시범을 영구 삭제할까요?"
        description="영구 삭제되며 되돌릴 수 없습니다."
        primaryActionProps={{
          children: "영구 삭제",
          variant: "criticalSolid",
          onClick: () =>
            deleteMutation.mutate({
              path: { example_id: example.id },
              body: { operation_id: crypto.randomUUID() },
            }),
        }}
        secondaryActionProps={{ children: "취소" }}
      />
    </AdminCard>
  );
}

/** 저장된 Plan JSON과 프리뷰를 나란히 보여주고, admin은 같은 자리에서 편집한다. */
function PlanSection({
  example,
  canEdit,
  onUpdated,
}: {
  example: AuthoringExampleDetailOut;
  /** admin 역할일 때만 편집 가능 */
  canEdit: boolean;
  onUpdated: (value: AuthoringExampleDetailOut) => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  /* input 모티프 자리만 있는 시범(시드 등)은 프리뷰 전용으로 모티프를 골라 볼 수 있다.
     저장하지 않는다 — 실제 생성에서는 사용자가 고른 모티프가 이 자리에 들어간다. */
  const [previewMotifIds, setPreviewMotifIds] = useState<string[]>([]);
  const [previewMotifLabels, setPreviewMotifLabels] = useState<
    Record<string, string>
  >({});
  const inputCount = planInputMotifCount(example.plan);
  const previewPickerVisible = example.motif_ids.length === 0 && inputCount > 0;
  /* 서버는 motif_ids를 주면 모든 input_index를 정확히 커버하길 요구한다 —
     선택이 미완이면 보내지 않고 placeholder 폴백으로 그린다 */
  const effectiveMotifIds =
    previewPickerVisible && previewMotifIds.length === inputCount
      ? previewMotifIds
      : example.motif_ids;
  const mutation = useMutation({
    ...updateAuthoringExampleMutation(),
    onSuccess: async (value) => {
      snackbar("few-shot 시범과 임베딩을 갱신했습니다.");
      onUpdated(value);
      setEditing(false);
      await queryClient.invalidateQueries({
        queryKey: listAuthoringExamplesQueryKey(),
      });
    },
  });

  if (!editing) {
    return (
      <Grid columns={{ base: 1, lg: 2 }} gap="x5" alignItems="start">
        <AdminCard
          title="Plan JSON"
          description="저장된 DesignPlanV3 원문입니다."
          action={
            canEdit && (
              <ActionButton
                variant="neutralWeak"
                onClick={() => {
                  mutation.reset();
                  setEditing(true);
                }}
              >
                수정
              </ActionButton>
            )
          }
        >
          <TextAreaField
            label="Plan (DesignPlanV3)"
            readOnly
            rows={24}
            spellCheck={false}
            value={planJsonText(example.plan)}
          />
        </AdminCard>
        {/* 스티키 기준선은 sticky Header(md+ 64px = x16) 아래 — 안 그러면 헤더에 가린다 */}
        <Box
          position={{ base: "static", lg: "sticky" }}
          top="calc(var(--spacing-x16) + var(--spacing-x4))"
        >
          <PlanPreviewCard
            plan={example.plan}
            motifIds={effectiveMotifIds}
            footer={
              previewPickerVisible
                ? () => (
                    <VStack gap="x2" alignItems="stretch">
                      <MotifPicker
                        value={previewMotifIds}
                        labels={previewMotifLabels}
                        max={inputCount}
                        label="프리뷰 모티프"
                        description="실제 생성에서는 사용자가 고른 모티프가 이 자리에 들어갑니다. 여기서 고른 모티프는 프리뷰에만 적용되고 저장되지 않습니다."
                        onChange={(ids, labels) => {
                          setPreviewMotifIds(ids);
                          setPreviewMotifLabels(labels);
                        }}
                      />
                      {previewMotifIds.length > 0 &&
                        previewMotifIds.length < inputCount && (
                          <Text textStyle="caption" color="fg.neutral-muted">
                            모티프 {inputCount}개를 모두 고르면 프리뷰에
                            적용됩니다.
                          </Text>
                        )}
                    </VStack>
                  )
                : undefined
            }
          />
        </Box>
      </Grid>
    );
  }

  return (
    <AuthoringExampleForm
      key={example.updated_at}
      initialRetrievalText={example.retrieval_text}
      initialPlan={example.plan}
      initialMotifIds={example.motif_ids}
      submitLabel="시범 변경 저장"
      submitting={mutation.isPending}
      submitError={mutation.isError ? mutation.error : undefined}
      onSubmit={(value: AuthoringExampleFormValue) => {
        mutation.mutate({
          path: { example_id: example.id },
          body: {
            operation_id: crypto.randomUUID(),
            expected_updated_at: example.updated_at,
            retrieval_text: value.retrievalText,
            plan: value.plan,
            motif_ids: value.motifIds,
          },
        });
      }}
      onCancel={() => {
        mutation.reset();
        setEditing(false);
      }}
    />
  );
}

export function AuthoringExampleDetailPage() {
  const { exampleId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { state } = useAdminSession();
  const requestOptions = {
    path: { example_id: exampleId },
  };
  const options = getAuthoringExampleOptions(requestOptions);
  const query = useQuery({ ...options, enabled: exampleId !== "" });

  if (query.isLoading) {
    return (
      <VStack gap="x6" alignItems="stretch" aria-busy="true">
        <RouteHeading
          title="few-shot 시범 상세"
          description="few-shot 시범의 계약과 활성 상태를 불러오고 있습니다."
        />
        <ContentPlaceholder title="few-shot 시범을 불러오고 있습니다" />
      </VStack>
    );
  }
  if (query.isError || query.data === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading title="few-shot 시범 상세" />
        <ContentPlaceholder
          title="few-shot 시범을 불러오지 못했습니다"
          action={
            <ActionButton onClick={() => void query.refetch()}>
              다시 시도
            </ActionButton>
          }
        />
      </VStack>
    );
  }

  const example = query.data;
  const canEdit =
    state.status === "authenticated" && state.session.role === "admin";
  const updateExample = (value: AuthoringExampleDetailOut) => {
    queryClient.setQueryData(
      getAuthoringExampleQueryKey(requestOptions),
      value,
    );
  };
  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title={example.example_id}
          description={`few-shot 시범 ID: ${example.id}`}
        />
        <HStack gap="x2">
          <StatusBadge status={example.active ? "active" : "inactive"} />
          <ActionButton
            variant="ghost"
            onClick={() => navigate("/few-shot-examples")}
          >
            목록으로
          </ActionButton>
        </HStack>
      </HStack>

      <ActivationAction example={example} onUpdated={updateExample} />

      <AdminCard title="검색 intent">
        <VStack gap="x4" alignItems="stretch">
          <VStack gap="x1" alignItems="stretch">
            <Text textStyle="caption" color="fg.neutral-muted">
              검색에 주입되는 intent
            </Text>
            <Text textStyle="bodySm" className="whitespace-pre-wrap">
              {example.retrieval_text}
            </Text>
          </VStack>
          {example.tags.length > 0 && (
            <TagGroup>
              {example.tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </TagGroup>
          )}
        </VStack>
      </AdminCard>

      <PlanSection
        example={example}
        canEdit={canEdit}
        onUpdated={updateExample}
      />

      <AdminCard title="검증·활성 정보">
        <DetailList
          items={[
            {
              label: "출처",
              value:
                example.source === "authored"
                  ? "직접 작성"
                  : example.source === "promoted"
                    ? "관리자 승격"
                    : "초기 시범",
            },
            { label: "family", value: example.family },
            { label: "motif 수", value: `${example.motif_count}개` },
            { label: "Plan 계약", value: `v${example.contract_version}` },
            { label: "embedding", value: example.embedding_model },
            {
              label: "검증 시각",
              value: example.approved_at
                ? formatDateTime(example.approved_at)
                : "-",
            },
            {
              label: "활성 변경 시각",
              value: example.active_updated_at
                ? formatDateTime(example.active_updated_at)
                : "-",
            },
            { label: "등록 시각", value: formatDateTime(example.created_at) },
            { label: "수정 시각", value: formatDateTime(example.updated_at) },
          ]}
        />
      </AdminCard>

      <TechnicalDetails
        title="few-shot 기술 정보"
        json={{
          structural_fingerprint: example.structural_fingerprint,
          source_digest: example.source_digest,
          motif_ids: example.motif_ids,
        }}
      />
    </VStack>
  );
}

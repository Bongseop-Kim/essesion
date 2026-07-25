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
  Callout,
  ContentPlaceholder,
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
import { TechnicalDetails } from "../../shared/ui/technical-details";
import {
  AuthoringExampleForm,
  type AuthoringExampleFormValue,
} from "./example-studio";

function ActivationAction({
  example,
  onUpdated,
}: {
  example: AuthoringExampleDetailOut;
  onUpdated: (value: AuthoringExampleDetailOut) => void;
}) {
  const queryClient = useQueryClient();
  const { state } = useAdminSession();
  const canEdit =
    state.status === "authenticated" && state.session.role === "admin";
  const targetActive = !example.active;
  const activationLabel =
    example.active_updated_at === null ? "활성화" : "재활성화";
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const mutation = useMutation({
    ...setAuthoringExampleActivationMutation(),
    onSuccess: async (value) => {
      snackbar(
        value.active
          ? "RAG 시범을 활성화했습니다."
          : "RAG 시범을 즉시 제외했습니다.",
      );
      onUpdated(value);
      setEditing(false);
      setReason("");
      setOperationId(crypto.randomUUID());
      await queryClient.invalidateQueries({
        queryKey: listAuthoringExamplesQueryKey(),
      });
    },
  });

  if (!canEdit) {
    return (
      <AdminCard title="RAG 활성 상태">
        <Text textStyle="bodySm" color="fg.neutral-muted">
          manager 역할은 상태와 이력을 조회할 수 있지만 활성 상태는 변경할 수
          없습니다.
        </Text>
      </AdminCard>
    );
  }

  const submit = () => {
    if (reason.trim().length < 3) return;
    mutation.mutate({
      path: { example_id: example.id },
      body: {
        operation_id: operationId,
        active: targetActive,
        reason: reason.trim(),
        expected_updated_at: example.updated_at,
      },
    });
  };

  return (
    <AdminCard
      title="RAG 활성 상태"
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
        {!editing ? (
          <HStack>
            <ActionButton
              variant={example.active ? "criticalSolid" : "brandSolid"}
              onClick={() => {
                mutation.reset();
                setEditing(true);
                setReason("");
                setOperationId(crypto.randomUUID());
              }}
            >
              {targetActive ? `시범 ${activationLabel}` : "시범 비활성화"}
            </ActionButton>
          </HStack>
        ) : (
          <VStack gap="x3" alignItems="stretch">
            <TextAreaField
              label={targetActive ? `${activationLabel} 사유` : "비활성화 사유"}
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
                variant={targetActive ? "brandSolid" : "criticalSolid"}
                disabled={reason.trim().length < 3}
                loading={mutation.isPending}
                onClick={() => setConfirmOpen(true)}
              >
                변경 검토
              </ActionButton>
              <ActionButton
                variant="ghost"
                disabled={mutation.isPending}
                onClick={() => setEditing(false)}
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
            title="활성 상태를 변경하지 못했습니다"
            description={getErrorMessage(
              mutation.error,
              "최신 상태와 중복 검사 결과를 확인한 뒤 다시 시도해 주세요.",
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
            ? "검증을 통과하면 다음 검색부터 즉시 RAG 대상이 됩니다."
            : "다음 RAG 검색부터 즉시 제외되며 기록은 유지됩니다."
        }
        primaryActionProps={{
          children: targetActive ? activationLabel : "비활성화",
          variant: targetActive ? "brandSolid" : "criticalSolid",
          onClick: submit,
        }}
        secondaryActionProps={{ children: "취소" }}
      />
    </AdminCard>
  );
}

function AuthoredExampleActions({
  example,
  onUpdated,
}: {
  example: AuthoringExampleDetailOut;
  onUpdated: (value: AuthoringExampleDetailOut) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [updateReason, setUpdateReason] = useState("");
  const [updateOperationId, setUpdateOperationId] = useState(() =>
    crypto.randomUUID(),
  );
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteOperationId, setDeleteOperationId] = useState(() =>
    crypto.randomUUID(),
  );
  const [deleteOpen, setDeleteOpen] = useState(false);
  const updateMutation = useMutation({
    ...updateAuthoringExampleMutation(),
    onSuccess: async (value) => {
      snackbar("RAG 시범과 임베딩을 갱신했습니다.");
      onUpdated(value);
      setUpdateReason("");
      setUpdateOperationId(crypto.randomUUID());
      await queryClient.invalidateQueries({
        queryKey: listAuthoringExamplesQueryKey(),
      });
    },
  });
  const deleteMutation = useMutation({
    ...deleteAuthoringExampleMutation(),
    onSuccess: async () => {
      snackbar("직접 작성한 RAG 시범을 삭제했습니다.");
      await queryClient.invalidateQueries({
        queryKey: listAuthoringExamplesQueryKey(),
      });
      navigate("/authoring-examples?tab=examples");
    },
  });
  const update = (value: AuthoringExampleFormValue) => {
    if (updateReason.trim().length < 3) return;
    updateMutation.mutate({
      path: { example_id: example.id },
      body: {
        operation_id: updateOperationId,
        reason: updateReason.trim(),
        expected_updated_at: example.updated_at,
        retrieval_text: value.retrievalText,
        plan: value.plan,
        motif_ids: value.motifIds,
      },
    });
  };

  return (
    <VStack gap="x5" alignItems="stretch">
      <AdminCard
        title="직접 작성 시범 편집"
        description="Plan이나 intent가 바뀌면 현재 모델로 임베딩과 구조 메타데이터를 다시 계산합니다."
      >
        <VStack gap="x4" alignItems="stretch">
          <TextAreaField
            label="변경 사유"
            required
            maxLength={500}
            value={updateReason}
            disabled={updateMutation.isPending}
            errorMessage={
              updateReason !== "" && updateReason.trim().length < 3
                ? "3자 이상 입력해 주세요."
                : undefined
            }
            onChange={(event) => {
              if (updateMutation.isError) {
                updateMutation.reset();
                setUpdateOperationId(crypto.randomUUID());
              }
              setUpdateReason(event.currentTarget.value);
            }}
          />
          <AuthoringExampleForm
            key={example.updated_at}
            initialRetrievalText={example.retrieval_text}
            initialPlan={example.plan}
            initialMotifIds={example.motif_ids}
            submitLabel="시범 변경 저장"
            submitting={updateMutation.isPending}
            submitDisabled={updateReason.trim().length < 3}
            submitError={
              updateMutation.isError ? updateMutation.error : undefined
            }
            onSubmit={update}
          />
        </VStack>
      </AdminCard>
      <AdminCard
        title="직접 작성 시범 삭제"
        description="authored 시범만 영구 삭제할 수 있으며, 활성 시범은 먼저 비활성화해야 합니다."
      >
        <VStack gap="x3" alignItems="stretch">
          {example.active && (
            <Callout
              tone="warning"
              title="활성 시범은 삭제할 수 없습니다"
              description="위에서 비활성화한 뒤 영구 삭제해 주세요."
            />
          )}
          <TextAreaField
            label="삭제 사유"
            required
            maxLength={500}
            value={deleteReason}
            disabled={deleteMutation.isPending || example.active}
            errorMessage={
              deleteReason !== "" && deleteReason.trim().length < 3
                ? "3자 이상 입력해 주세요."
                : undefined
            }
            onChange={(event) => {
              if (deleteMutation.isError) {
                deleteMutation.reset();
                setDeleteOperationId(crypto.randomUUID());
              }
              setDeleteReason(event.currentTarget.value);
            }}
          />
          <ActionButton
            variant="criticalSolid"
            loading={deleteMutation.isPending}
            disabled={example.active || deleteReason.trim().length < 3}
            onClick={() => setDeleteOpen(true)}
          >
            시범 영구 삭제
          </ActionButton>
        </VStack>
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
      </AdminCard>
      <AlertDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="이 직접 작성 시범을 영구 삭제할까요?"
        description="비활성 시범과 감사 사유를 남기고 삭제하며 되돌릴 수 없습니다."
        primaryActionProps={{
          children: "영구 삭제",
          variant: "criticalSolid",
          onClick: () =>
            deleteMutation.mutate({
              path: { example_id: example.id },
              body: {
                operation_id: deleteOperationId,
                reason: deleteReason.trim(),
              },
            }),
        }}
        secondaryActionProps={{ children: "취소" }}
      />
    </VStack>
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
          title="RAG 시범 상세"
          description="RAG 시범의 계약과 활성 상태를 불러오고 있습니다."
        />
        <ContentPlaceholder title="RAG 시범을 불러오고 있습니다" />
      </VStack>
    );
  }
  if (query.isError || query.data === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading title="RAG 시범 상세" />
        <ContentPlaceholder
          title="RAG 시범을 불러오지 못했습니다"
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
          description={`RAG 시범 ID: ${example.id}`}
        />
        <HStack gap="x2">
          <StatusBadge status={example.active ? "active" : "inactive"} />
          <ActionButton
            variant="ghost"
            onClick={() => navigate("/authoring-examples?tab=examples")}
          >
            목록으로
          </ActionButton>
        </HStack>
      </HStack>

      <ActivationAction example={example} onUpdated={updateExample} />

      {example.source === "authored" &&
        state.status === "authenticated" &&
        state.session.role === "admin" && (
          <AuthoredExampleActions example={example} onUpdated={updateExample} />
        )}

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
            {
              label: "활성 변경 사유",
              value: formatIdentifier(example.active_reason),
            },
            { label: "등록 시각", value: formatDateTime(example.created_at) },
            { label: "수정 시각", value: formatDateTime(example.updated_at) },
          ]}
        />
      </AdminCard>

      <TechnicalDetails
        title="Plan·RAG 기술 정보"
        json={{
          plan: example.plan,
          structural_fingerprint: example.structural_fingerprint,
          source_digest: example.source_digest,
        }}
      />
    </VStack>
  );
}

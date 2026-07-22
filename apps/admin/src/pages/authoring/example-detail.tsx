import type { AuthoringExampleDetailOut } from "@essesion/api-client";
import {
  getAuthoringExampleOptions,
  getAuthoringExampleQueryKey,
  listAuthoringExamplesQueryKey,
  setAuthoringExampleActivationMutation,
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
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const mutation = useMutation({
    ...setAuthoringExampleActivationMutation(),
    onSuccess: async (value) => {
      snackbar(
        value.active
          ? "RAG 예시를 활성화했습니다."
          : "RAG 예시를 즉시 제외했습니다.",
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
          : "재활성화할 때 현재 계약·임베딩과 중복을 다시 확인합니다."
      }
    >
      <VStack gap="x4" alignItems="stretch">
        {example.active && (
          <Callout
            tone="warning"
            title="비활성화는 즉시 적용됩니다"
            description="새 생성 요청의 few-shot 검색에서 이 예시가 바로 제외됩니다."
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
              {targetActive ? "예시 재활성화" : "예시 비활성화"}
            </ActionButton>
          </HStack>
        ) : (
          <VStack gap="x3" alignItems="stretch">
            <TextAreaField
              label={targetActive ? "재활성화 사유" : "비활성화 사유"}
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
            ? "이 예시를 다시 활성화할까요?"
            : "이 예시를 비활성화할까요?"
        }
        description={
          targetActive
            ? "검증을 통과하면 다음 검색부터 즉시 RAG 대상이 됩니다."
            : "다음 RAG 검색부터 즉시 제외되며 기록은 유지됩니다."
        }
        primaryActionProps={{
          children: targetActive ? "재활성화" : "비활성화",
          variant: targetActive ? "brandSolid" : "criticalSolid",
          onClick: submit,
        }}
        secondaryActionProps={{ children: "취소" }}
      />
    </AdminCard>
  );
}

export function AuthoringExampleDetailPage() {
  const { exampleId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const requestOptions = {
    path: { example_id: exampleId },
  };
  const options = getAuthoringExampleOptions(requestOptions);
  const query = useQuery({ ...options, enabled: exampleId !== "" });

  if (query.isLoading) {
    return (
      <VStack gap="x6" alignItems="stretch" aria-busy="true">
        <RouteHeading
          title="승인 예시 상세"
          description="RAG 예시의 계약과 활성 상태를 불러오고 있습니다."
        />
        <ContentPlaceholder title="승인 예시를 불러오고 있습니다" />
      </VStack>
    );
  }
  if (query.isError || query.data === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading title="승인 예시 상세" />
        <ContentPlaceholder
          title="승인 예시를 불러오지 못했습니다"
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
          description={`승인 예시 ID: ${example.id}`}
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

      <AdminCard title="검색 문서">
        <VStack gap="x4" alignItems="stretch">
          <VStack gap="x1" alignItems="stretch">
            <Text textStyle="caption" color="fg.neutral-muted">
              원본 사용자 요청
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

      <AdminCard title="승인·활성 정보">
        <DetailList
          items={[
            {
              label: "출처",
              value:
                example.source === "promoted" ? "관리자 승격" : "초기 예시",
            },
            { label: "family", value: example.family },
            { label: "motif 수", value: `${example.motif_count}개` },
            { label: "Plan 계약", value: `v${example.contract_version}` },
            { label: "embedding", value: example.embedding_model },
            {
              label: "승인 시각",
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
        title="Plan·검색 기술 정보"
        json={{
          plan: example.plan,
          structural_fingerprint: example.structural_fingerprint,
          source_digest: example.source_digest,
        }}
      />
    </VStack>
  );
}

import {
  answerAdminInquiryMutation,
  getAdminInquiryOptions,
  getAdminInquiryQueryKey,
  listAdminInquiriesQueryKey,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Callout,
  ContentPlaceholder,
  HStack,
  Skeleton,
  snackbar,
  Text,
  TextAreaField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import {
  formatDateTime,
  formatIdentifier,
  getErrorMessage,
} from "../../shared/lib/format";
import { useDirtyFormBlocker } from "../../shared/lib/use-dirty-form-blocker";
import { AdminCard } from "../../shared/ui/admin-card";
import { DetailList } from "../../shared/ui/detail-list";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";

type AnswerMode = "read" | "edit" | "review";

export function InquiryDetailPage() {
  const { inquiryId = "" } = useParams();
  const queryClient = useQueryClient();
  const query = useQuery({
    ...getAdminInquiryOptions({ path: { inquiry_id: inquiryId } }),
    enabled: inquiryId !== "",
  });
  const [answer, setAnswer] = useState("");
  const [baseAnswer, setBaseAnswer] = useState("");
  const [baseRevision, setBaseRevision] = useState("");
  const [loadedInquiryId, setLoadedInquiryId] = useState("");
  const [answerMode, setAnswerMode] = useState<AnswerMode>("read");
  const dirty =
    query.data !== undefined &&
    loadedInquiryId === query.data.id &&
    answer !== baseAnswer;
  const blocker = useDirtyFormBlocker(dirty);

  useEffect(() => {
    if (query.data === undefined) return;
    const changedInquiry = loadedInquiryId !== query.data.id;
    const changedWhileClean = !dirty && baseRevision !== query.data.updated_at;
    if (!changedInquiry && !changedWhileClean) return;
    setAnswer(query.data.answer ?? "");
    setBaseAnswer(query.data.answer ?? "");
    setBaseRevision(query.data.updated_at);
    setLoadedInquiryId(query.data.id);
    if (changedInquiry) setAnswerMode("read");
  }, [baseRevision, dirty, loadedInquiryId, query.data]);

  const mutation = useMutation({
    ...answerAdminInquiryMutation(),
    onSuccess: async (data) => {
      queryClient.setQueryData(
        getAdminInquiryQueryKey({ path: { inquiry_id: inquiryId } }),
        data,
      );
      setAnswer(data.answer ?? "");
      setBaseAnswer(data.answer ?? "");
      setBaseRevision(data.updated_at);
      setAnswerMode("read");
      snackbar("문의 답변을 저장했습니다.");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getAdminInquiryQueryKey({
            path: { inquiry_id: inquiryId },
          }),
        }),
        queryClient.invalidateQueries({
          queryKey: listAdminInquiriesQueryKey(),
        }),
      ]);
    },
  });

  if (query.isLoading) {
    return (
      <VStack gap="x6" alignItems="stretch" aria-busy="true">
        <RouteHeading
          title="문의 상세"
          description="문의를 불러오고 있습니다."
        />
        <AdminCard title="문의 내용">
          <Skeleton width="100%" height={160} />
        </AdminCard>
      </VStack>
    );
  }
  if (query.isError || query.data === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading title="문의 상세" description="고객 문의를 확인합니다." />
        <ContentPlaceholder
          title="문의를 불러오지 못했습니다"
          action={
            <ActionButton onClick={() => void query.refetch()}>
              다시 시도
            </ActionButton>
          }
        />
      </VStack>
    );
  }

  const data = query.data;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (
      answer.trim().length === 0 ||
      answer.length > 5000 ||
      mutation.isPending
    )
      return;
    setAnswerMode("review");
  };

  const startEditing = () => {
    mutation.reset();
    setAnswer(baseAnswer);
    setAnswerMode("edit");
  };

  const cancelEditing = () => {
    mutation.reset();
    setAnswer(baseAnswer);
    setAnswerMode("read");
  };
  const save = () => {
    if (answer.trim().length === 0 || mutation.isPending) return;
    mutation.mutate({
      path: { inquiry_id: data.id },
      body: { expected_updated_at: baseRevision, answer: answer.trim() },
    });
  };

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title={data.title}
          description={`${data.category} 문의의 고객·상품 문맥을 확인합니다.`}
        />
        <StatusBadge status={data.status} />
      </HStack>
      <AdminCard title="문의 정보">
        <DetailList
          items={[
            {
              label: "고객",
              value: data.customer ? (
                <Link to={`/customers/${data.customer.id}`}>
                  {data.customer.name}
                </Link>
              ) : (
                "탈퇴/비회원 고객"
              ),
            },
            { label: "이메일", value: formatIdentifier(data.customer?.email) },
            {
              label: "전화번호",
              value: formatIdentifier(data.customer?.phone),
            },
            {
              label: "관련 상품",
              value: data.product
                ? `${data.product.name} · ${data.product.code ?? data.product.id}`
                : "-",
            },
            { label: "문의일", value: formatDateTime(data.created_at) },
            { label: "수정일", value: formatDateTime(data.updated_at) },
          ]}
        />
      </AdminCard>
      <AdminCard title="문의 내용">
        <Text className="whitespace-pre-wrap break-words">{data.content}</Text>
      </AdminCard>
      {answerMode === "read" && (
        <AdminCard
          title="고객 답변"
          action={
            <ActionButton
              variant="neutralWeak"
              size="small"
              onClick={startEditing}
            >
              {data.answer === null ? "답변 작성" : "답변 수정"}
            </ActionButton>
          }
        >
          {data.answer === null ? (
            <Text textStyle="bodySm" color="fg.neutral-muted">
              아직 등록된 답변이 없습니다.
            </Text>
          ) : (
            <VStack gap="x3" alignItems="stretch">
              <Text className="whitespace-pre-wrap break-words">
                {data.answer}
              </Text>
              <Text textStyle="caption" color="fg.neutral-muted">
                {data.answer_actor?.name ?? "담당자 미상"} ·{" "}
                {formatDateTime(data.answer_date)}
              </Text>
            </VStack>
          )}
        </AdminCard>
      )}

      {answerMode === "edit" && (
        <AdminCard title={baseAnswer === "" ? "답변 작성" : "답변 수정"}>
          <VStack as="form" gap="x3" alignItems="stretch" onSubmit={submit}>
            <TextAreaField
              label="답변"
              required
              maxLength={5000}
              value={answer}
              errorMessage={
                answer !== "" && answer.trim().length === 0
                  ? "공백만 입력할 수 없습니다."
                  : undefined
              }
              onChange={(event) => setAnswer(event.currentTarget.value)}
            />
            {mutation.isError && (
              <Callout
                role="alert"
                tone="critical"
                title="답변을 저장하지 못했습니다"
                description={getErrorMessage(
                  mutation.error,
                  "다른 관리자가 먼저 답변했을 수 있습니다. 작성한 답변은 유지되므로 최신 내용을 비교해 주세요.",
                )}
              />
            )}
            <HStack gap="x2" wrap>
              <ActionButton
                type="submit"
                disabled={!dirty || answer.trim().length === 0}
              >
                답변 미리보기
              </ActionButton>
              <ActionButton
                type="button"
                variant="ghost"
                disabled={mutation.isPending}
                onClick={cancelEditing}
              >
                편집 취소
              </ActionButton>
            </HStack>
          </VStack>
        </AdminCard>
      )}

      {answerMode === "review" && (
        <AdminCard
          title="답변 미리보기"
          description="고객에게 표시될 답변을 마지막으로 확인해 주세요."
        >
          <VStack gap="x4" alignItems="stretch">
            {baseAnswer !== "" && (
              <VStack gap="x1">
                <Text textStyle="caption" color="fg.neutral-muted">
                  현재 답변
                </Text>
                <Text className="whitespace-pre-wrap break-words">
                  {baseAnswer}
                </Text>
              </VStack>
            )}
            <VStack gap="x1">
              <Text textStyle="caption" color="fg.neutral-muted">
                {baseAnswer === "" ? "등록할 답변" : "수정할 답변"}
              </Text>
              <Text className="whitespace-pre-wrap break-words">
                {answer.trim()}
              </Text>
            </VStack>
            <Callout
              tone="informative"
              title={
                data.customer === null
                  ? "탈퇴/비회원 고객에게 표시되는 답변입니다"
                  : `${data.customer.name} 고객에게 표시되는 답변입니다`
              }
              description="편집을 시작한 문의 수정 시각을 기준으로 동시 변경 여부를 확인합니다."
            />
            {mutation.isError && (
              <Callout
                role="alert"
                tone="critical"
                title="답변을 저장하지 못했습니다"
                description={getErrorMessage(
                  mutation.error,
                  "다른 관리자가 먼저 답변했을 수 있습니다. 작성한 답변은 유지되므로 최신 내용을 비교해 주세요.",
                )}
              />
            )}
            <HStack gap="x2" wrap>
              <ActionButton
                variant="ghost"
                disabled={mutation.isPending}
                onClick={() => setAnswerMode("edit")}
              >
                내용 수정
              </ActionButton>
              <ActionButton loading={mutation.isPending} onClick={save}>
                {baseAnswer === "" ? "답변 등록" : "답변 수정"}
              </ActionButton>
            </HStack>
          </VStack>
        </AdminCard>
      )}
      <AlertDialog
        open={blocker.state === "blocked"}
        title="작성 중인 답변을 버릴까요?"
        description="저장하지 않은 답변이 사라집니다."
        primaryActionProps={{
          children: "답변 버리기",
          variant: "criticalSolid",
          onClick: () => blocker.proceed?.(),
        }}
        secondaryActionProps={{
          children: "계속 작성",
          onClick: () => blocker.reset?.(),
        }}
      />
    </VStack>
  );
}

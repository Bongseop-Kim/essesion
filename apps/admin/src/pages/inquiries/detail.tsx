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
  const [confirmOpen, setConfirmOpen] = useState(false);
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
    setConfirmOpen(true);
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
      {data.answer !== null && (
        <AdminCard title="현재 답변">
          <VStack gap="x3" alignItems="stretch">
            <Text className="whitespace-pre-wrap break-words">
              {data.answer}
            </Text>
            <Text textStyle="caption" color="fg.neutral-muted">
              {data.answer_actor?.name ?? "담당자 미상"} ·{" "}
              {formatDateTime(data.answer_date)}
            </Text>
          </VStack>
        </AdminCard>
      )}
      <AdminCard title={data.answer === null ? "답변 작성" : "답변 수정"}>
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
          <HStack gap="x2">
            <ActionButton
              type="submit"
              disabled={!dirty || answer.trim().length === 0}
              loading={mutation.isPending}
            >
              답변 확인
            </ActionButton>
            <ActionButton
              type="button"
              variant="ghost"
              disabled={!dirty || mutation.isPending}
              onClick={() => setAnswer(baseAnswer)}
            >
              변경 취소
            </ActionButton>
          </HStack>
        </VStack>
      </AdminCard>
      <AlertDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={
          data.answer === null
            ? "답변을 등록할까요?"
            : "기존 답변을 수정할까요?"
        }
        description="현재 문의의 최신 수정 시각을 확인한 뒤 저장하며, 중복 제출은 차단됩니다."
        primaryActionProps={{
          children: "저장",
          loading: mutation.isPending,
          disabled: mutation.isPending,
          onClick: save,
        }}
        secondaryActionProps={{
          children: "취소",
          disabled: mutation.isPending,
        }}
      />
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

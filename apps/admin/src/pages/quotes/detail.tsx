import type {
  AdminQuoteAction,
  AdminQuoteImageOut,
} from "@essesion/api-client";
import {
  createAdminQuoteImageReadUrlMutation,
  getAdminQuoteOptions,
  getAdminQuoteQueryKey,
  listAdminQuotesQueryKey,
  updateAdminQuoteStatusMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Box,
  Callout,
  ContentPlaceholder,
  HStack,
  Skeleton,
  snackbar,
  Text,
  TextAreaField,
  TextField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router";

import {
  formatDateTime,
  formatIdentifier,
  formatMoney,
  getErrorMessage,
} from "../../shared/lib/format";
import { useDirtyFormBlocker } from "../../shared/lib/use-dirty-form-blocker";
import { AdminCard } from "../../shared/ui/admin-card";
import { DetailList } from "../../shared/ui/detail-list";
import { PrivateAssetPreview } from "../../shared/ui/private-asset-preview";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";

function QuoteImage({
  quoteId,
  image,
}: {
  quoteId: string;
  image: AdminQuoteImageOut;
}) {
  const [readUrl, setReadUrl] = useState<string>();
  const mutation = useMutation({
    ...createAdminQuoteImageReadUrlMutation(),
    onSuccess: (data) => setReadUrl(data.read_url),
  });

  return (
    <PrivateAssetPreview
      src={readUrl}
      alt="견적 참고 자료"
      metadata={
        <>
          {image.content_type ?? "파일"} · {formatDateTime(image.created_at)}
        </>
      }
      loading={mutation.isPending}
      error={mutation.isError}
      errorDescription="만료되었거나 이 견적에 속하지 않은 이미지입니다."
      onRequest={() =>
        mutation.mutate({
          path: { quote_id: quoteId, image_id: image.id },
        })
      }
    />
  );
}

export function QuoteDetailPage() {
  const { quoteId = "" } = useParams();
  const queryClient = useQueryClient();
  const query = useQuery({
    ...getAdminQuoteOptions({ path: { quote_id: quoteId } }),
    enabled: quoteId !== "",
  });
  const [selectedAction, setSelectedAction] = useState<AdminQuoteAction>();
  const [baseRevision, setBaseRevision] = useState("");
  const [amount, setAmount] = useState("");
  const [conditions, setConditions] = useState("");
  const [adminMemo, setAdminMemo] = useState("");
  const [transitionMemo, setTransitionMemo] = useState("");
  const [validationError, setValidationError] = useState<string>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const blocker = useDirtyFormBlocker(selectedAction !== undefined);

  const mutation = useMutation({
    ...updateAdminQuoteStatusMutation(),
    onSuccess: async () => {
      snackbar("견적을 변경했습니다.");
      setSelectedAction(undefined);
      setBaseRevision("");
      setTransitionMemo("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getAdminQuoteQueryKey({ path: { quote_id: quoteId } }),
        }),
        queryClient.invalidateQueries({ queryKey: listAdminQuotesQueryKey() }),
      ]);
    },
  });

  if (query.isLoading) {
    return (
      <VStack gap="x6" alignItems="stretch" aria-busy="true">
        <RouteHeading
          title="견적 상세"
          description="견적을 불러오고 있습니다."
        />
        <AdminCard title="견적 정보">
          <Skeleton width="100%" height={120} />
        </AdminCard>
      </VStack>
    );
  }
  if (query.isError || query.data === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading title="견적 상세" description="견적 요청을 확인합니다." />
        <ContentPlaceholder
          title="견적을 불러오지 못했습니다"
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
  const selectAction = (action: AdminQuoteAction) => {
    setSelectedAction(action);
    setBaseRevision(data.updated_at);
    setAmount(data.quoted_amount?.toString() ?? "");
    setConditions(data.quote_conditions ?? "");
    setAdminMemo(data.admin_memo ?? "");
    setTransitionMemo("");
    setValidationError(undefined);
  };
  const runAction = () => {
    if (!selectedAction || mutation.isPending) return;
    const numericAmount = amount.trim() === "" ? null : Number(amount);
    mutation.mutate({
      path: { quote_id: data.id },
      body: {
        expected_updated_at: baseRevision,
        new_status: selectedAction.target_status,
        quoted_amount: numericAmount,
        quote_conditions: conditions.trim(),
        admin_memo: adminMemo.trim(),
        memo: transitionMemo.trim() || null,
      },
    });
  };
  const submitAction = (event: FormEvent) => {
    event.preventDefault();
    setValidationError(undefined);
    const numericAmount = amount.trim() === "" ? null : Number(amount);
    if (
      numericAmount !== null &&
      (!Number.isInteger(numericAmount) || numericAmount < 0)
    ) {
      setValidationError("견적 금액은 0 이상의 정수로 입력해 주세요.");
      return;
    }
    if (
      selectedAction?.target_status === "견적발송" &&
      numericAmount === null &&
      data.quoted_amount === null
    ) {
      setValidationError("견적발송 전 견적 금액을 입력해 주세요.");
      return;
    }
    setConfirmOpen(true);
  };
  const address = data.shipping_address;

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title={`견적 ${data.quote_number}`}
          description="저장된 배송지 snapshot과 상태 변경 근거를 확인합니다."
        />
        <StatusBadge status={data.status} />
      </HStack>
      <AdminCard title="요청 정보">
        <DetailList
          items={[
            {
              label: "고객",
              value: (
                <Link to={`/customers/${data.customer.id}`}>
                  {data.customer.name}
                </Link>
              ),
            },
            { label: "이메일", value: formatIdentifier(data.customer.email) },
            { label: "사업자명", value: data.business_name },
            {
              label: "수량",
              value: `${data.quantity.toLocaleString("ko-KR")}개`,
            },
            { label: "담당자", value: data.contact_name },
            {
              label: "연락 방법",
              value: `${data.contact_method} · ${data.contact_value}`,
            },
            { label: "요청일", value: formatDateTime(data.created_at) },
            { label: "수정일", value: formatDateTime(data.updated_at) },
          ]}
        />
      </AdminCard>
      <AdminCard title="거래 시점 배송지">
        {address ? (
          <DetailList
            items={[
              {
                label: "받는 분",
                value: `${address.recipient_name} · ${address.recipient_phone}`,
              },
              {
                label: "주소",
                value: `${address.postal_code} ${address.address} ${address.address_detail ?? ""}`,
              },
              {
                label: "배송 메모",
                value: address.delivery_memo ?? address.delivery_request ?? "-",
              },
              {
                label: "snapshot 기준",
                value: formatIdentifier(data.shipping_address_id),
              },
            ]}
          />
        ) : (
          <Text color="fg.neutral-muted">저장된 배송지가 없습니다.</Text>
        )}
      </AdminCard>
      <AdminCard title="요청 조건">
        <VStack gap="x4" alignItems="stretch">
          <DetailList
            items={[
              { label: "추가 요청", value: data.additional_notes || "-" },
              { label: "견적 금액", value: formatMoney(data.quoted_amount) },
              { label: "견적 조건", value: data.quote_conditions ?? "-" },
              { label: "관리자 메모", value: data.admin_memo ?? "-" },
            ]}
          />
          <Box
            as="pre"
            bg="bg.neutral-weak"
            borderRadius="r2"
            p="x4"
            overflow="auto"
          >
            <Text as="code" textStyle="caption">
              {JSON.stringify(data.options, null, 2)}
            </Text>
          </Box>
        </VStack>
      </AdminCard>
      <AdminCard
        title="참고 이미지"
        description="관계 검증 후 발급되는 짧은 수명의 읽기 URL만 사용합니다."
      >
        {(data.images ?? []).length === 0 ? (
          <Text color="fg.neutral-muted">등록된 참고 이미지가 없습니다.</Text>
        ) : (
          <VStack gap="x5" alignItems="stretch">
            {(data.images ?? []).map((image) => (
              <QuoteImage key={image.id} quoteId={data.id} image={image} />
            ))}
          </VStack>
        )}
      </AdminCard>
      <AdminCard title="상태 변경 이력">
        {(data.status_logs ?? []).length === 0 ? (
          <Text color="fg.neutral-muted">상태 변경 이력이 없습니다.</Text>
        ) : (
          <VStack as="ol" gap="x3" alignItems="stretch">
            {(data.status_logs ?? []).map((log) => (
              <VStack as="li" key={log.id} gap="x1">
                <Text textStyle="bodySm">
                  {log.previous_status} → {log.new_status} ·{" "}
                  {log.actor?.name ?? "시스템"}
                </Text>
                <Text textStyle="caption" color="fg.neutral-muted">
                  {formatDateTime(log.created_at)} · {log.memo ?? "메모 없음"} ·
                  요청 {log.request_id ?? "-"}
                </Text>
              </VStack>
            ))}
          </VStack>
        )}
      </AdminCard>
      <AdminCard title="서버 허용 액션">
        <VStack gap="x4" alignItems="stretch">
          <HStack gap="x2" wrap>
            {(data.admin_actions ?? []).map((action) => (
              <ActionButton
                key={action.target_status}
                variant={
                  action.destructive ? "criticalSolid" : "neutralOutline"
                }
                disabled={!action.enabled || mutation.isPending}
                title={action.blocking_reason ?? undefined}
                onClick={() => selectAction(action)}
              >
                {action.label}
              </ActionButton>
            ))}
          </HStack>
          {selectedAction && (
            <VStack
              as="form"
              gap="x3"
              alignItems="stretch"
              onSubmit={submitAction}
            >
              <Text as="h3" textStyle="label">
                {selectedAction.label}
              </Text>
              <TextField
                type="number"
                min={0}
                step={1}
                label="견적 금액"
                suffix="원"
                value={amount}
                errorMessage={validationError}
                onChange={(event) => setAmount(event.currentTarget.value)}
              />
              <TextAreaField
                label="견적 조건"
                maxLength={5000}
                value={conditions}
                onChange={(event) => setConditions(event.currentTarget.value)}
              />
              <TextAreaField
                label="관리자 메모"
                maxLength={5000}
                value={adminMemo}
                onChange={(event) => setAdminMemo(event.currentTarget.value)}
              />
              <TextAreaField
                label="상태 변경 근거"
                maxLength={500}
                value={transitionMemo}
                onChange={(event) =>
                  setTransitionMemo(event.currentTarget.value)
                }
              />
              {mutation.isError && (
                <Callout
                  role="alert"
                  tone="critical"
                  title="견적을 변경하지 못했습니다"
                  description={getErrorMessage(
                    mutation.error,
                    "다른 관리자가 먼저 변경했을 수 있습니다. 입력은 유지되므로 최신 내용을 새 창에서 비교해 주세요.",
                  )}
                />
              )}
              <HStack gap="x2">
                <ActionButton type="submit" loading={mutation.isPending}>
                  변경 내용 확인
                </ActionButton>
                <ActionButton
                  type="button"
                  variant="ghost"
                  disabled={mutation.isPending}
                  onClick={() => setSelectedAction(undefined)}
                >
                  취소
                </ActionButton>
              </HStack>
            </VStack>
          )}
        </VStack>
      </AdminCard>
      <AlertDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`${selectedAction?.target_status ?? "선택 상태"}(으)로 변경할까요?`}
        description={`견적 금액 ${amount || "미입력"}원 · 근거 ${transitionMemo.trim() || "없음"}`}
        primaryActionProps={{
          children: "변경",
          variant: selectedAction?.destructive ? "criticalSolid" : "brandSolid",
          loading: mutation.isPending,
          onClick: runAction,
        }}
        secondaryActionProps={{
          children: "취소",
          disabled: mutation.isPending,
        }}
      />
      <AlertDialog
        open={blocker.state === "blocked"}
        title="작성 중인 견적 변경을 버릴까요?"
        description="입력한 금액·조건·메모가 사라집니다."
        primaryActionProps={{
          children: "변경 버리기",
          variant: "criticalSolid",
          onClick: () => blocker.proceed?.(),
        }}
        secondaryActionProps={{
          children: "계속 편집",
          onClick: () => blocker.reset?.(),
        }}
      />
    </VStack>
  );
}

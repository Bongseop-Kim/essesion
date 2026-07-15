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
  Callout,
  ContentPlaceholder,
  HStack,
  Skeleton,
  snackbar,
  TabContent,
  TabList,
  Tabs,
  TabTrigger,
  Text,
  TextAreaField,
  TextField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

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
import { TechnicalDetails } from "../../shared/ui/technical-details";

const QUOTE_TABS = [
  "summary",
  "specification",
  "proposal",
  "images",
  "history",
] as const;
type QuoteTab = (typeof QUOTE_TABS)[number];

const QUOTE_STAGES = [
  { value: "요청", label: "요청" },
  { value: "견적발송", label: "견적 발송" },
  { value: "협의중", label: "협의 중" },
  { value: "확정", label: "확정" },
  { value: "종료", label: "종료" },
] as const;

const OPTION_LABELS: Record<string, string> = {
  fabric_provided: "원단 제공",
  reorder: "재주문",
  fabric_type: "원단",
  design_type: "디자인 방식",
  tie_type: "타이 형태",
  interlining: "심지",
  size_type: "규격",
  tie_width: "타이 폭",
  triangle_stitch: "삼각 봉제",
  side_stitch: "옆선 봉제",
  bar_tack: "바택",
  fold7: "7단 접기",
  dimple: "딤플",
  turn_knot: "돌려묶기",
  spoderato: "스포데라토",
  brand_label: "브랜드 라벨",
  care_label: "케어 라벨",
};

const OPTION_VALUES: Record<string, string> = {
  SILK: "실크",
  POLY: "폴리",
  YARN_DYED: "선염",
  PRINTING: "날염",
  AUTO: "자동 타이",
  MANUAL: "수동 타이",
  WOOL: "울",
  ADULT: "성인용",
  CHILD: "아동용",
};

const QUOTE_ACTION_LABELS: Partial<
  Record<AdminQuoteAction["target_status"], string>
> = {
  협의중: "협의 시작",
  확정: "견적 확정",
  종료: "견적 종료",
};

function formatQuoteOption(key: string, value: unknown) {
  if (typeof value === "boolean") return value ? "포함" : "미포함";
  if (key === "tie_width" && typeof value === "number") return `${value}cm`;
  if (key === "tie_type" && (value === "" || value === "MANUAL")) {
    return "수동 타이";
  }
  if (key === "interlining" && value === "") return "폴리";
  if (value === null || value === "") return "해당 없음";
  if (typeof value === "string") return OPTION_VALUES[value] ?? value;
  if (typeof value === "number") return value.toLocaleString("ko-KR");
  return "기술 정보에서 확인";
}

function quoteActionLabel(
  action: AdminQuoteAction,
  status: string,
  hasQuotedAmount: boolean,
) {
  if (status === "요청" && action.target_status === "견적발송") {
    return hasQuotedAmount ? "견적 수정·발송" : "견적 작성·발송";
  }
  return QUOTE_ACTION_LABELS[action.target_status] ?? action.label;
}

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
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const tab: QuoteTab = QUOTE_TABS.includes(requestedTab as QuoteTab)
    ? (requestedTab as QuoteTab)
    : "summary";
  const setTab = (nextTab: string) => {
    const next = new URLSearchParams(searchParams);
    if (nextTab === "summary") next.delete("tab");
    else next.set("tab", nextTab);
    setSearchParams(next, { replace: true });
  };
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
  const primaryAction = (data.admin_actions ?? []).find(
    (action) => action.enabled,
  );
  const optionItems = Object.entries(data.options).map(([key, value]) => ({
    label: OPTION_LABELS[key] ?? "추가 사양",
    value: formatQuoteOption(key, value),
  }));

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title={`견적 ${data.quote_number}`}
          description="저장된 배송지 snapshot과 상태 변경 근거를 확인합니다."
        />
        <StatusBadge status={data.status} />
      </HStack>
      <AdminCard title="진행 단계">
        <HStack gap="x2" wrap aria-label={`현재 단계 ${data.status}`}>
          {QUOTE_STAGES.map((stage, index) => (
            <HStack key={stage.value} gap="x2">
              <Text
                textStyle="bodySm"
                color={
                  stage.value === data.status ? "fg.brand" : "fg.neutral-muted"
                }
              >
                {stage.value === data.status
                  ? `현재: ${stage.label}`
                  : stage.label}
              </Text>
              {index < QUOTE_STAGES.length - 1 && (
                <Text aria-hidden color="fg.neutral-muted">
                  →
                </Text>
              )}
            </HStack>
          ))}
        </HStack>
      </AdminCard>
      <AdminCard
        title="견적 작업"
        description="견적 내용과 다음 상태를 첫 화면에서 확인하고 변경합니다."
      >
        <VStack gap="x4" alignItems="stretch">
          <HStack gap="x2" wrap>
            {primaryAction && (
              <ActionButton
                disabled={mutation.isPending}
                onClick={() => selectAction(primaryAction)}
              >
                {quoteActionLabel(
                  primaryAction,
                  data.status,
                  data.quoted_amount !== null,
                )}
              </ActionButton>
            )}
            {(data.admin_actions ?? [])
              .filter(
                (action) =>
                  action.target_status !== primaryAction?.target_status,
              )
              .map((action) => (
                <ActionButton
                  key={action.target_status}
                  variant={
                    action.destructive ? "criticalSolid" : "neutralOutline"
                  }
                  disabled={!action.enabled || mutation.isPending}
                  title={action.blocking_reason ?? undefined}
                  onClick={() => selectAction(action)}
                >
                  {quoteActionLabel(
                    action,
                    data.status,
                    data.quoted_amount !== null,
                  )}
                </ActionButton>
              ))}
          </HStack>
          {!primaryAction && (
            <Text textStyle="bodySm" color="fg.neutral-muted">
              현재 상태에서 실행할 수 있는 작업이 없습니다.
            </Text>
          )}
          {selectedAction && (
            <VStack
              as="form"
              gap="x3"
              alignItems="stretch"
              onSubmit={submitAction}
            >
              <Text as="h3" textStyle="label">
                {quoteActionLabel(
                  selectedAction,
                  data.status,
                  data.quoted_amount !== null,
                )}
              </Text>
              <Callout
                tone="informative"
                title={`저장하면 ${selectedAction.target_status} 상태로 변경됩니다`}
                description="고객에게 보일 금액과 조건을 먼저 확인해 주세요."
              />
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
      <Tabs value={tab} onValueChange={setTab}>
        <TabList aria-label="견적 상세 메뉴">
          <TabTrigger value="summary">요청 요약</TabTrigger>
          <TabTrigger value="specification">제작 사양</TabTrigger>
          <TabTrigger value="proposal">견적 제안</TabTrigger>
          <TabTrigger value="images">참고 이미지</TabTrigger>
          <TabTrigger value="history">이력</TabTrigger>
        </TabList>

        <TabContent value="summary">
          <VStack gap="x5" pt="x5" alignItems="stretch">
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
                  {
                    label: "이메일",
                    value: formatIdentifier(data.customer.email),
                  },
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
                      value:
                        address.delivery_memo ??
                        address.delivery_request ??
                        "-",
                    },
                  ]}
                />
              ) : (
                <Text color="fg.neutral-muted">저장된 배송지가 없습니다.</Text>
              )}
            </AdminCard>
          </VStack>
        </TabContent>

        <TabContent value="specification">
          <VStack gap="x5" pt="x5" alignItems="stretch">
            <AdminCard title="제작 사양">
              {optionItems.length > 0 ? (
                <DetailList items={optionItems} />
              ) : (
                <Text color="fg.neutral-muted">제작 사양이 없습니다.</Text>
              )}
            </AdminCard>
            <AdminCard title="추가 요청">
              <Text style={{ whiteSpace: "pre-wrap" }}>
                {data.additional_notes || "추가 요청이 없습니다."}
              </Text>
            </AdminCard>
            <TechnicalDetails
              json={{
                quote_id: data.id,
                shipping_address_id: data.shipping_address_id,
                options: data.options,
                status_logs: (data.status_logs ?? []).map((log) => ({
                  log_id: log.id,
                  request_id: log.request_id,
                })),
              }}
            />
          </VStack>
        </TabContent>

        <TabContent value="proposal">
          <VStack gap="x5" pt="x5" alignItems="stretch">
            <AdminCard
              title="고객에게 보일 견적"
              description="저장 전에 고객 화면에 표시될 핵심 내용을 확인합니다."
            >
              <DetailList
                items={[
                  { label: "상태", value: data.status },
                  {
                    label: "견적 금액",
                    value: formatMoney(data.quoted_amount),
                  },
                  { label: "견적 조건", value: data.quote_conditions ?? "-" },
                ]}
              />
            </AdminCard>
            <AdminCard title="내부 메모">
              <Text style={{ whiteSpace: "pre-wrap" }}>
                {data.admin_memo ?? "작성된 관리자 메모가 없습니다."}
              </Text>
            </AdminCard>
          </VStack>
        </TabContent>

        <TabContent value="images">
          <VStack pt="x5" alignItems="stretch">
            <AdminCard
              title="참고 이미지"
              description="관계 검증 후 발급되는 짧은 수명의 읽기 URL만 사용합니다."
            >
              {(data.images ?? []).length === 0 ? (
                <Text color="fg.neutral-muted">
                  등록된 참고 이미지가 없습니다.
                </Text>
              ) : (
                <VStack gap="x5" alignItems="stretch">
                  {(data.images ?? []).map((image) => (
                    <QuoteImage
                      key={image.id}
                      quoteId={data.id}
                      image={image}
                    />
                  ))}
                </VStack>
              )}
            </AdminCard>
          </VStack>
        </TabContent>

        <TabContent value="history">
          <VStack pt="x5" alignItems="stretch">
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
                        {formatDateTime(log.created_at)} ·{" "}
                        {log.memo ?? "메모 없음"}
                      </Text>
                    </VStack>
                  ))}
                </VStack>
              )}
            </AdminCard>
          </VStack>
        </TabContent>
      </Tabs>
      <AlertDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`${selectedAction?.target_status ?? "선택 상태"}(으)로 변경할까요?`}
        description={`상태 ${data.status} → ${selectedAction?.target_status ?? "선택 상태"} · 견적 금액 ${formatMoney(data.quoted_amount)} → ${amount === "" ? "미입력" : formatMoney(Number(amount))} · 견적 조건 ${conditions.trim() || "없음"} · 변경 근거 ${transitionMemo.trim() || "없음"}`}
        primaryActionProps={{
          children: selectedAction
            ? `${selectedAction.target_status} 상태로 변경`
            : "견적 변경",
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

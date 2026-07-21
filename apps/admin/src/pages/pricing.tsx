import type { PricingValueOut } from "@essesion/api-client";
import {
  getAdminPricingOptions,
  getAdminPricingQueryKey,
  updateAdminPricingMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Callout,
  ContentPlaceholder,
  Grid,
  HStack,
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
import { useEffect, useMemo, useState } from "react";

import { formatDateTime, getErrorMessage } from "../shared/lib/format";
import { useDirtyFormBlocker } from "../shared/lib/use-dirty-form-blocker";
import { useAdminSession } from "../shared/session/admin-session";
import { AdminCard } from "../shared/ui/admin-card";
import { ChangeReviewDialog } from "../shared/ui/change-review-dialog";
import { EditModeShell } from "../shared/ui/edit-mode-shell";
import { RouteHeading } from "../shared/ui/route-heading";
import {
  AdminTable,
  type AdminTableColumn,
} from "../widgets/admin-table/admin-table";

const CATEGORY_TABS = [
  { value: "reform", label: "수선" },
  { value: "custom_order", label: "주문제작" },
  { value: "fabric", label: "원단" },
  { value: "sample_discount", label: "샘플 할인" },
  { value: "token", label: "토큰" },
] as const;

// 라벨 원문: YeongSeon admin pricing-form의 CONSTANT_LABELS·SAMPLE_COUPON_LABELS
const PRICING_LABELS: Record<string, string> = {
  REFORM_AUTOMATIC_COST: "자동수선 비용",
  REFORM_WIDTH_COST: "폭수선 비용",
  REFORM_RESTORATION_COST: "복원수선 비용",
  REFORM_AUTOMATIC_COMBINED_COST: "자동+폭·복원 결합 비용",
  REFORM_WIDTH_RESTORATION_COST: "폭+복원 결합 비용",
  REFORM_SHIPPING_COST: "수선 택배비",
  REFORM_PICKUP_FEE: "방문 수거비",
  START_COST: "봉제 시작 비용 (기본 세팅비)",
  SEWING_PER_COST: "봉제 단가",
  AUTO_TIE_COST: "자동 타이",
  TRIANGLE_STITCH_COST: "삼각 봉제",
  SIDE_STITCH_COST: "옆선 봉제",
  BAR_TACK_COST: "바택",
  DIMPLE_COST: "딤플",
  SPODERATO_COST: "스포데라토",
  FOLD7_COST: "7폴드",
  WOOL_INTERLINING_COST: "울 심지 추가",
  BRAND_LABEL_COST: "브랜드 라벨",
  CARE_LABEL_COST: "케어 라벨",
  YARN_DYED_DESIGN_COST: "선염 디자인 비용",
  FABRIC_PRINTING_POLY: "날염 원단 (폴리)",
  FABRIC_PRINTING_SILK: "날염 원단 (실크)",
  FABRIC_YARN_DYED_POLY: "선염 원단 (폴리)",
  FABRIC_YARN_DYED_SILK: "선염 원단 (실크)",
  SAMPLE_SEWING_COST: "봉제 샘플",
  SAMPLE_FABRIC_PRINTING_COST: "원단 샘플 (날염)",
  SAMPLE_FABRIC_YARN_DYED_COST: "원단 샘플 (선염)",
  SAMPLE_FABRIC_AND_SEWING_PRINTING_COST: "원단+봉제 샘플 (날염)",
  SAMPLE_FABRIC_AND_SEWING_YARN_DYED_COST: "원단+봉제 샘플 (선염)",
  sample_discount_sewing: "봉제 샘플 할인",
  sample_discount_fabric_printing: "원단 샘플 (날염) 할인",
  sample_discount_fabric_yarn_dyed: "원단 샘플 (선염) 할인",
  sample_discount_fabric_and_sewing_printing: "원단+봉제 샘플 (날염) 할인",
  sample_discount_fabric_and_sewing_yarn_dyed: "원단+봉제 샘플 (선염) 할인",
  token_plan_starter_price: "Starter 플랜 가격",
  token_plan_starter_amount: "Starter 플랜 토큰 수량",
  token_plan_popular_price: "Popular 플랜 가격",
  token_plan_popular_amount: "Popular 플랜 토큰 수량",
  token_plan_pro_price: "Pro 플랜 가격",
  token_plan_pro_amount: "Pro 플랜 토큰 수량",
};

function pricingLabel(key: string) {
  return PRICING_LABELS[key] ?? key;
}

function newOperationId() {
  return crypto.randomUUID();
}

function pricingDraft(items: readonly PricingValueOut[]) {
  return Object.fromEntries(
    items.map((item) => [item.key, String(item.amount)]),
  );
}

function formatPricingAmount(item: PricingValueOut, value = item.amount) {
  return `${Number(value).toLocaleString("ko-KR")}${item.unit}`;
}

const readOnlyColumns: readonly AdminTableColumn<PricingValueOut>[] = [
  {
    key: "name",
    header: "항목",
    render: (item) => pricingLabel(item.key),
  },
  {
    key: "amount",
    header: "현재 가격",
    align: "end",
    render: (item) => formatPricingAmount(item),
  },
  {
    key: "updated",
    header: "최근 변경",
    visibility: "medium",
    render: (item) => formatDateTime(item.updated_at),
  },
];

export function PricingPage() {
  const queryClient = useQueryClient();
  const { state } = useAdminSession();
  const query = useQuery(getAdminPricingOptions());
  const [baseItems, setBaseItems] = useState<PricingValueOut[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [operationId, setOperationId] = useState(newOperationId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<string>(CATEGORY_TABS[0].value);

  const changed = useMemo(
    () =>
      baseItems.filter(
        (item) =>
          draft[item.key] !== undefined &&
          draft[item.key] !== String(item.amount),
      ),
    [baseItems, draft],
  );
  const isDirty = editing && (changed.length > 0 || reason !== "");
  const blocker = useDirtyFormBlocker(isDirty);
  const canEdit =
    state.status === "authenticated" && state.session.role === "admin";

  useEffect(() => {
    if (query.data === undefined || editing) return;
    setBaseItems(query.data);
    setDraft(pricingDraft(query.data));
  }, [editing, query.data]);

  const mutation = useMutation({
    ...updateAdminPricingMutation(),
    onSuccess: async (data) => {
      snackbar("가격 설정을 저장했습니다.");
      setBaseItems(data);
      setDraft(pricingDraft(data));
      setReason("");
      setOperationId(newOperationId());
      queryClient.setQueryData(getAdminPricingQueryKey(), data);
      setEditing(false);
      setConfirmOpen(false);
      await queryClient.invalidateQueries({
        queryKey: getAdminPricingQueryKey(),
      });
    },
  });

  const resetFailedOperation = () => {
    if (!mutation.isError) return;
    setOperationId(newOperationId());
    mutation.reset();
  };

  if (query.isLoading) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading
          title="가격 관리"
          description="서비스별 가격을 불러오고 있습니다."
        />
        <ContentPlaceholder title="가격 설정을 불러오고 있습니다" />
      </VStack>
    );
  }
  if (query.isError || query.data === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading
          title="가격 관리"
          description="서비스별 현재 가격과 변경 시각을 확인합니다."
        />
        <ContentPlaceholder
          title="가격 설정을 불러오지 못했습니다"
          action={
            <ActionButton onClick={() => void query.refetch()}>
              다시 시도
            </ActionButton>
          }
        />
      </VStack>
    );
  }

  const groups = baseItems.reduce<Record<string, PricingValueOut[]>>(
    (result, item) => {
      const group = result[item.category] ?? [];
      group.push(item);
      result[item.category] = group;
      return result;
    },
    {},
  );
  const invalid = changed.some((item) => {
    const value = Number(draft[item.key]);
    return !Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000;
  });

  const save = () => {
    if (changed.length === 0 || invalid || reason.trim().length < 3) return;
    mutation.mutate({
      body: {
        operation_id: operationId,
        reason: reason.trim(),
        items: changed.map((item) => ({
          key: item.key,
          amount: Number(draft[item.key]),
          expected_updated_at: item.updated_at,
        })),
      },
    });
  };

  const startEditing = () => {
    setBaseItems(query.data);
    setDraft(pricingDraft(query.data));
    setReason("");
    setOperationId(newOperationId());
    setConfirmOpen(false);
    mutation.reset();
    setEditing(true);
  };

  const cancelEditing = () => {
    setBaseItems(query.data);
    setDraft(pricingDraft(query.data));
    setReason("");
    setOperationId(newOperationId());
    setConfirmOpen(false);
    setEditing(false);
    mutation.reset();
  };

  const pricingTabs = (
    <Tabs value={tab} onValueChange={setTab}>
      <TabList aria-label="가격 분류 선택" triggerLayout="fill">
        {CATEGORY_TABS.map((category) => (
          <TabTrigger key={category.value} value={category.value}>
            {category.label}
          </TabTrigger>
        ))}
      </TabList>
      {CATEGORY_TABS.map((category) => (
        <TabContent key={category.value} value={category.value}>
          <VStack pt="x5" alignItems="stretch">
            <AdminCard
              title={`${category.label} 가격`}
              description={
                editing
                  ? "숫자는 0 이상 10억 이하의 정수로 입력해 주세요."
                  : "현재 적용 중인 값과 최근 변경 시각입니다."
              }
            >
              {editing ? (
                <Grid columns={{ base: 1, md: 2 }} gap="x4">
                  {(groups[category.value] ?? []).map((item) => (
                    <TextField
                      key={item.key}
                      type="number"
                      min={0}
                      max={1_000_000_000}
                      step={1}
                      label={pricingLabel(item.key)}
                      description={`현재 ${formatPricingAmount(item)}`}
                      suffix={item.unit}
                      value={draft[item.key] ?? String(item.amount)}
                      disabled={mutation.isPending}
                      onChange={(event) => {
                        resetFailedOperation();
                        const value = event.currentTarget.value;
                        setDraft((current) => ({
                          ...current,
                          [item.key]: value,
                        }));
                      }}
                    />
                  ))}
                </Grid>
              ) : (
                <AdminTable
                  label={`${category.label} 가격표`}
                  columns={readOnlyColumns}
                  rows={groups[category.value] ?? []}
                  getRowKey={(item) => item.key}
                  status="success"
                  emptyTitle="등록된 가격이 없습니다"
                />
              )}
            </AdminCard>
          </VStack>
        </TabContent>
      ))}
    </Tabs>
  );

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title="가격 관리"
          description="현재 가격을 확인한 뒤 명시적으로 편집을 시작합니다."
        />
        {canEdit && !editing && (
          <ActionButton onClick={startEditing}>가격 수정</ActionButton>
        )}
      </HStack>
      {!canEdit && (
        <Text textStyle="bodySm" color="fg.neutral-muted">
          조회 전용 권한입니다. 가격 변경은 admin 역할만 실행할 수 있습니다.
        </Text>
      )}
      {editing ? (
        <EditModeShell
          status={
            changed.length === 0
              ? "변경한 가격이 없습니다."
              : `${changed.length}개 가격을 변경했습니다.`
          }
          actions={
            <>
              <ActionButton
                variant="ghost"
                disabled={mutation.isPending}
                onClick={cancelEditing}
              >
                편집 취소
              </ActionButton>
              <ActionButton
                disabled={
                  changed.length === 0 || invalid || reason.trim().length < 3
                }
                loading={mutation.isPending}
                onClick={() => setConfirmOpen(true)}
              >
                변경 {changed.length}건 검토
              </ActionButton>
            </>
          }
        >
          {pricingTabs}
          <AdminCard title="변경 사유와 영향">
            <VStack gap="x4" alignItems="stretch">
              {changed.length > 0 && (
                <VStack as="ul" gap="x2" alignItems="stretch">
                  {changed.map((item) => (
                    <Text as="li" key={item.key} textStyle="bodySm">
                      {pricingLabel(item.key)}: {formatPricingAmount(item)} →{" "}
                      {formatPricingAmount(item, Number(draft[item.key]))}
                    </Text>
                  ))}
                </VStack>
              )}
              <Text textStyle="caption" color="fg.neutral-muted">
                저장 즉시 신규 주문 계산에 적용됩니다. 이미 생성된 주문과 견적의
                저장 금액은 변경되지 않습니다.
              </Text>
              <TextAreaField
                label="변경 사유"
                required
                maxLength={500}
                value={reason}
                errorMessage={
                  reason !== "" && reason.trim().length < 3
                    ? "3자 이상 입력해 주세요."
                    : undefined
                }
                disabled={mutation.isPending}
                onChange={(event) => {
                  resetFailedOperation();
                  setReason(event.currentTarget.value);
                }}
              />
              {invalid && (
                <Callout
                  role="alert"
                  tone="critical"
                  title="가격은 0 이상의 정수여야 합니다"
                />
              )}
              {mutation.isError && (
                <Callout
                  role="alert"
                  tone="critical"
                  title="가격을 저장하지 못했습니다"
                  description={getErrorMessage(
                    mutation.error,
                    "다른 관리자가 먼저 변경했을 수 있습니다. 입력은 보존되며 재조회 후 비교할 수 있습니다.",
                  )}
                />
              )}
            </VStack>
          </AdminCard>
        </EditModeShell>
      ) : (
        pricingTabs
      )}

      <ChangeReviewDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`${changed.length}개 가격을 즉시 적용할까요?`}
        items={changed.map((item) => ({
          label: pricingLabel(item.key),
          before: formatPricingAmount(item),
          after: formatPricingAmount(item, Number(draft[item.key])),
        }))}
        reason={reason.trim()}
        impact="신규 주문 계산부터 적용되며 기존 주문·견적의 저장 금액은 유지됩니다."
        confirmLabel={`가격 ${changed.length}건 적용`}
        loading={mutation.isPending}
        onConfirm={save}
      />
      <AlertDialog
        open={blocker.state === "blocked"}
        title="저장하지 않은 변경을 버릴까요?"
        description="입력한 가격과 사유가 사라집니다."
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

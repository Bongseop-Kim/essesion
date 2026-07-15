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

import { getErrorMessage } from "../shared/lib/format";
import { useDirtyFormBlocker } from "../shared/lib/use-dirty-form-blocker";
import { useAdminSession } from "../shared/session/admin-session";
import { AdminCard } from "../shared/ui/admin-card";
import { RouteHeading } from "../shared/ui/route-heading";

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

export function PricingPage() {
  const queryClient = useQueryClient();
  const { state } = useAdminSession();
  const query = useQuery(getAdminPricingOptions());
  const [baseItems, setBaseItems] = useState<PricingValueOut[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [operationId, setOperationId] = useState(newOperationId);
  const [confirmOpen, setConfirmOpen] = useState(false);
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
  const isDirty = changed.length > 0 || reason !== "";
  const blocker = useDirtyFormBlocker(isDirty);
  const canEdit =
    state.status === "authenticated" && state.session.role === "admin";

  useEffect(() => {
    if (query.data === undefined || isDirty) return;
    setBaseItems(query.data);
    setDraft(pricingDraft(query.data));
  }, [isDirty, query.data]);

  const mutation = useMutation({
    ...updateAdminPricingMutation(),
    onSuccess: async (data) => {
      snackbar("가격 설정을 저장했습니다.");
      setBaseItems(data);
      setDraft(pricingDraft(data));
      setReason("");
      setOperationId(newOperationId());
      await queryClient.invalidateQueries({
        queryKey: getAdminPricingQueryKey(),
      });
    },
  });

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

  return (
    <VStack gap="x6" alignItems="stretch">
      <RouteHeading
        title="가격 관리"
        description="모든 변경은 서버에서 한 트랜잭션으로 검증·저장됩니다."
      />
      {!canEdit && (
        <Callout
          tone="informative"
          title="조회 전용 권한"
          description="가격 변경은 admin 역할만 실행할 수 있습니다."
        />
      )}
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
              <AdminCard title={`${category.label} 가격`}>
                <Grid columns={{ base: 1, md: 2 }} gap="x4">
                  {(groups[category.value] ?? []).map((item) => (
                    <TextField
                      key={item.key}
                      type="number"
                      min={0}
                      max={1_000_000_000}
                      step={1}
                      label={pricingLabel(item.key)}
                      suffix={item.unit}
                      value={draft[item.key] ?? String(item.amount)}
                      disabled={!canEdit || mutation.isPending}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setDraft((current) => ({
                          ...current,
                          [item.key]: value,
                        }));
                      }}
                    />
                  ))}
                </Grid>
              </AdminCard>
            </VStack>
          </TabContent>
        ))}
      </Tabs>

      {canEdit && (
        <AdminCard title="변경 확인" description={`operation ${operationId}`}>
          <VStack gap="x4" alignItems="stretch">
            {changed.length === 0 ? (
              <Text color="fg.neutral-muted">변경한 가격이 없습니다.</Text>
            ) : (
              <VStack as="ul" gap="x2">
                {changed.map((item) => (
                  <Text as="li" key={item.key} textStyle="bodySm">
                    {pricingLabel(item.key)}: {item.amount} → {draft[item.key]}{" "}
                    {item.unit}
                  </Text>
                ))}
              </VStack>
            )}
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
              onChange={(event) => setReason(event.currentTarget.value)}
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
            <HStack gap="x2">
              <ActionButton
                disabled={
                  changed.length === 0 || invalid || reason.trim().length < 3
                }
                loading={mutation.isPending}
                onClick={() => setConfirmOpen(true)}
              >
                변경 내용 확인
              </ActionButton>
              <ActionButton
                variant="ghost"
                disabled={mutation.isPending || changed.length === 0}
                onClick={() => {
                  setBaseItems(query.data);
                  setDraft(pricingDraft(query.data));
                  setReason("");
                }}
              >
                변경 취소
              </ActionButton>
            </HStack>
          </VStack>
        </AdminCard>
      )}

      <AlertDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`${changed.length}개 가격을 변경할까요?`}
        description={`사유: ${reason.trim()}`}
        primaryActionProps={{
          children: "저장",
          loading: mutation.isPending,
          onClick: save,
        }}
        secondaryActionProps={{ children: "취소" }}
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

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
  Text,
  TextAreaField,
  TextField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  formatDateTime,
  formatMoney,
  getErrorMessage,
} from "../shared/lib/format";
import { useDirtyFormBlocker } from "../shared/lib/use-dirty-form-blocker";
import { useAdminSession } from "../shared/session/admin-session";
import { AdminCard } from "../shared/ui/admin-card";
import { RouteHeading } from "../shared/ui/route-heading";

function newOperationId() {
  return crypto.randomUUID();
}

export function PricingPage() {
  const queryClient = useQueryClient();
  const { state } = useAdminSession();
  const query = useQuery(getAdminPricingOptions());
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [operationId, setOperationId] = useState(newOperationId);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const original = useMemo(
    () =>
      Object.fromEntries(
        (query.data ?? []).map((item) => [item.key, String(item.amount)]),
      ),
    [query.data],
  );
  const changed = useMemo(
    () =>
      (query.data ?? []).filter(
        (item) =>
          draft[item.key] !== undefined &&
          draft[item.key] !== String(item.amount),
      ),
    [draft, query.data],
  );
  const isDirty = changed.length > 0 || reason !== "";
  const blocker = useDirtyFormBlocker(isDirty);
  const canEdit =
    state.status === "authenticated" && state.session.role === "admin";

  useEffect(() => {
    if (query.data !== undefined && !isDirty) setDraft(original);
  }, [isDirty, original, query.data]);

  const mutation = useMutation({
    ...updateAdminPricingMutation(),
    onSuccess: async () => {
      snackbar("가격 설정을 저장했습니다.");
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

  const groups = query.data.reduce<Record<string, PricingValueOut[]>>(
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
      {Object.entries(groups).map(([category, items]) => (
        <AdminCard key={category} title={category}>
          <Grid columns={{ base: 1, md: 2 }} gap="x4">
            {items.map((item) => (
              <VStack key={item.key} gap="x1_5" minWidth={0}>
                <TextField
                  type="number"
                  min={0}
                  max={1_000_000_000}
                  step={1}
                  label={item.key}
                  description={`${item.description} · ${formatDateTime(item.updated_at)}`}
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
                <Text textStyle="caption" color="fg.neutral-muted">
                  현재{" "}
                  {item.unit === "원"
                    ? formatMoney(item.amount)
                    : `${item.amount}개`}
                </Text>
              </VStack>
            ))}
          </Grid>
        </AdminCard>
      ))}

      {canEdit && (
        <AdminCard title="변경 확인" description={`operation ${operationId}`}>
          <VStack gap="x4" alignItems="stretch">
            {changed.length === 0 ? (
              <Text color="fg.neutral-muted">변경한 가격이 없습니다.</Text>
            ) : (
              <VStack as="ul" gap="x2">
                {changed.map((item) => (
                  <Text as="li" key={item.key} textStyle="bodySm">
                    {item.key}: {item.amount} → {draft[item.key]} {item.unit}
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
                  setDraft(original);
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

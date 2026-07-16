import type { AdminSettingOut } from "@essesion/api-client";
import {
  getAdminSettingsOptions,
  getAdminSettingsQueryKey,
  updateAdminSettingsMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Callout,
  ContentPlaceholder,
  snackbar,
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
import { DetailList } from "../shared/ui/detail-list";
import { EditModeShell } from "../shared/ui/edit-mode-shell";
import { RouteHeading } from "../shared/ui/route-heading";

function settingsDraft(items: readonly AdminSettingOut[]) {
  return Object.fromEntries(items.map((item) => [item.key, item.value]));
}

const SETTING_PRESENTATION: Record<
  string,
  { title: string; description: string; scope: string; defaultValue: string }
> = {
  default_courier_company: {
    title: "기본 택배사",
    description: "운영자가 송장을 등록할 때 기본으로 제안하는 택배사입니다.",
    scope: "새 배송·수거 송장 입력",
    defaultValue: "롯데택배",
  },
  design_token_initial_grant: {
    title: "신규 사용자 초기 토큰",
    description: "관리자가 새 계정을 만들 때 최초 지급하는 디자인 토큰입니다.",
    scope: "변경 후 생성되는 신규 계정",
    defaultValue: "30개",
  },
};

function settingPresentation(item: AdminSettingOut) {
  return (
    SETTING_PRESENTATION[item.key] ?? {
      title: "관리자 설정",
      description: "서버에서 허용한 운영 설정입니다.",
      scope: "관련 신규 작업",
      defaultValue: "확인되지 않음",
    }
  );
}

function formatSettingValue(item: AdminSettingOut, value = item.value) {
  if (item.value_type !== "non_negative_integer") return value;
  const number = Number(value);
  return Number.isFinite(number)
    ? `${number.toLocaleString("ko-KR")}개`
    : value;
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { state } = useAdminSession();
  const query = useQuery(getAdminSettingsOptions());
  const [baseItems, setBaseItems] = useState<AdminSettingOut[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const canEdit =
    state.status === "authenticated" && state.session.role === "admin";

  const changed = useMemo(
    () =>
      baseItems.filter(
        (item) =>
          draft[item.key] !== undefined && draft[item.key] !== item.value,
      ),
    [baseItems, draft],
  );
  const dirty = editingKey !== null && (changed.length > 0 || reason !== "");
  const blocker = useDirtyFormBlocker(dirty);

  useEffect(() => {
    if (query.data === undefined || editingKey !== null) return;
    setBaseItems(query.data);
    setDraft(settingsDraft(query.data));
  }, [editingKey, query.data]);

  const mutation = useMutation({
    ...updateAdminSettingsMutation(),
    onSuccess: async (data) => {
      snackbar("관리자 설정을 저장했습니다.");
      setBaseItems(data);
      setDraft(settingsDraft(data));
      setReason("");
      setOperationId(crypto.randomUUID());
      queryClient.setQueryData(getAdminSettingsQueryKey(), data);
      setEditingKey(null);
      setConfirmOpen(false);
      await queryClient.invalidateQueries({
        queryKey: getAdminSettingsQueryKey(),
      });
    },
  });

  const resetFailedOperation = () => {
    if (!mutation.isError) return;
    setOperationId(crypto.randomUUID());
    mutation.reset();
  };

  if (query.isLoading) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading
          title="설정"
          description="허용된 관리자 설정을 불러오고 있습니다."
        />
        <ContentPlaceholder title="설정을 불러오고 있습니다" />
      </VStack>
    );
  }
  if (query.isError || query.data === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading
          title="설정"
          description="허용된 관리자 설정 값을 확인합니다."
        />
        <ContentPlaceholder
          title="설정을 불러오지 못했습니다"
          description="필수 설정 행이 누락된 경우 배포 마이그레이션을 확인해 주세요."
          action={
            <ActionButton onClick={() => void query.refetch()}>
              다시 시도
            </ActionButton>
          }
        />
      </VStack>
    );
  }

  const invalid = changed.some((item) => {
    const value = draft[item.key] ?? "";
    if (item.value_type === "courier")
      return value.trim().length === 0 || value.length > 100;
    return !/^\d+$/.test(value) || Number(value) > 1_000_000;
  });

  const save = () => {
    if (changed.length === 0 || invalid || reason.trim().length < 3) return;
    mutation.mutate({
      body: {
        operation_id: operationId,
        reason: reason.trim(),
        items: changed.map((item) => ({
          key: item.key,
          value: draft[item.key] ?? "",
          expected_updated_at: item.updated_at,
        })),
      },
    });
  };

  const startEditing = (key: string) => {
    setBaseItems(query.data);
    setDraft(settingsDraft(query.data));
    setReason("");
    setOperationId(crypto.randomUUID());
    setConfirmOpen(false);
    mutation.reset();
    setEditingKey(key);
  };

  const cancelEditing = () => {
    setBaseItems(query.data);
    setDraft(settingsDraft(query.data));
    setReason("");
    setOperationId(crypto.randomUUID());
    setConfirmOpen(false);
    setEditingKey(null);
    mutation.reset();
  };

  const settingsCards = (
    <VStack gap="x4" alignItems="stretch">
      {baseItems.map((item) => {
        const presentation = settingPresentation(item);
        const editing = editingKey === item.key;
        return (
          <AdminCard
            key={item.key}
            title={presentation.title}
            description={`${presentation.description} · 최근 변경 ${formatDateTime(item.updated_at)}`}
            action={
              canEdit && editingKey === null ? (
                <ActionButton
                  variant="neutralOutline"
                  size="small"
                  onClick={() => startEditing(item.key)}
                >
                  수정
                </ActionButton>
              ) : undefined
            }
          >
            {editing ? (
              <VStack gap="x4" alignItems="stretch">
                <TextField
                  type={
                    item.value_type === "non_negative_integer"
                      ? "number"
                      : "text"
                  }
                  min={
                    item.value_type === "non_negative_integer" ? 0 : undefined
                  }
                  step={
                    item.value_type === "non_negative_integer" ? 1 : undefined
                  }
                  label={
                    item.value_type === "courier" ? "택배사명" : "토큰 수량"
                  }
                  description={`현재 ${formatSettingValue(item)}`}
                  suffix={
                    item.value_type === "non_negative_integer"
                      ? "개"
                      : undefined
                  }
                  value={draft[item.key] ?? item.value}
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
                {item.key === "design_token_initial_grant" && (
                  <Callout
                    tone="warning"
                    title="신규 계정의 토큰 비용 정책에 영향을 줍니다"
                    description="기존 계정의 토큰 잔액은 변경되지 않습니다."
                  />
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
                  onChange={(event) => {
                    resetFailedOperation();
                    setReason(event.currentTarget.value);
                  }}
                />
                {invalid && (
                  <Callout
                    role="alert"
                    tone="critical"
                    title="설정 값을 확인해 주세요"
                  />
                )}
                {mutation.isError && (
                  <Callout
                    role="alert"
                    tone="critical"
                    title="설정을 저장하지 못했습니다"
                    description={getErrorMessage(
                      mutation.error,
                      "stale 변경일 수 있습니다. 입력은 유지되므로 최신 값을 재조회해 비교해 주세요.",
                    )}
                  />
                )}
              </VStack>
            ) : (
              <DetailList
                items={[
                  { label: "현재 값", value: formatSettingValue(item) },
                  { label: "적용 범위", value: presentation.scope },
                  { label: "시스템 기본값", value: presentation.defaultValue },
                  {
                    label: "마지막 변경",
                    value: formatDateTime(item.updated_at),
                  },
                ]}
              />
            )}
          </AdminCard>
        );
      })}
    </VStack>
  );

  return (
    <VStack gap="x6" alignItems="stretch">
      <RouteHeading
        title="설정"
        description="현재 값을 확인한 뒤 필요한 설정 한 개만 편집합니다."
      />
      {!canEdit && (
        <Callout
          tone="informative"
          title="조회 전용 권한"
          description="전역 설정 변경은 admin 역할만 실행할 수 있습니다."
        />
      )}

      {editingKey === null ? (
        settingsCards
      ) : (
        <EditModeShell
          status={
            changed.length === 0
              ? "변경한 설정이 없습니다."
              : "설정 1개를 변경했습니다."
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
                설정 변경 검토
              </ActionButton>
            </>
          }
        >
          {settingsCards}
        </EditModeShell>
      )}

      <ChangeReviewDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="설정 변경을 적용할까요?"
        items={changed.map((item) => ({
          label: settingPresentation(item).title,
          before: formatSettingValue(item),
          after: formatSettingValue(item, draft[item.key]),
        }))}
        reason={reason.trim()}
        impact={
          changed[0]?.key === "design_token_initial_grant"
            ? "변경 후 생성되는 신규 계정에만 적용되며 기존 잔액은 유지됩니다."
            : "변경 후 입력하는 새 배송·수거 송장에 기본값으로 제안됩니다."
        }
        confirmLabel="설정 변경 적용"
        loading={mutation.isPending}
        onConfirm={save}
      />
      <AlertDialog
        open={blocker.state === "blocked"}
        title="저장하지 않은 변경을 버릴까요?"
        description="입력한 설정과 사유가 사라집니다."
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

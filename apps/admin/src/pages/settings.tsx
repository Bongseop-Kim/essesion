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
  HStack,
  snackbar,
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
import { RouteHeading } from "../shared/ui/route-heading";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { state } = useAdminSession();
  const query = useQuery(getAdminSettingsOptions());
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const canEdit =
    state.status === "authenticated" && state.session.role === "admin";

  const original = useMemo(
    () =>
      Object.fromEntries(
        (query.data ?? []).map((item) => [item.key, item.value]),
      ),
    [query.data],
  );
  const changed = useMemo(
    () =>
      (query.data ?? []).filter(
        (item) =>
          draft[item.key] !== undefined && draft[item.key] !== item.value,
      ),
    [draft, query.data],
  );
  const dirty = changed.length > 0 || reason !== "";
  const blocker = useDirtyFormBlocker(dirty);

  useEffect(() => {
    if (query.data !== undefined && !dirty) setDraft(original);
  }, [dirty, original, query.data]);

  const mutation = useMutation({
    ...updateAdminSettingsMutation(),
    onSuccess: async () => {
      snackbar("관리자 설정을 저장했습니다.");
      setReason("");
      setOperationId(crypto.randomUUID());
      await queryClient.invalidateQueries({
        queryKey: getAdminSettingsQueryKey(),
      });
    },
  });

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

  return (
    <VStack gap="x6" alignItems="stretch">
      <RouteHeading
        title="설정"
        description="허용된 typed 설정만 조회·수정하며 임의 key는 서버가 거부합니다."
      />
      {!canEdit && (
        <Callout
          tone="informative"
          title="조회 전용 권한"
          description="전역 설정 변경은 admin 역할만 실행할 수 있습니다."
        />
      )}

      {query.data.map((item) => (
        <AdminCard
          key={item.key}
          title={
            item.key === "default_courier_company"
              ? "기본 택배사"
              : "신규 사용자 초기 토큰"
          }
          description={`${item.key} · 마지막 수정 ${formatDateTime(item.updated_at)}`}
        >
          <TextField
            type={
              item.value_type === "non_negative_integer" ? "number" : "text"
            }
            min={item.value_type === "non_negative_integer" ? 0 : undefined}
            step={item.value_type === "non_negative_integer" ? 1 : undefined}
            label={item.value_type === "courier" ? "택배사명" : "토큰 수량"}
            suffix={
              item.value_type === "non_negative_integer" ? "개" : undefined
            }
            value={draft[item.key] ?? item.value}
            disabled={!canEdit || mutation.isPending}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setDraft((current) => ({
                ...current,
                [item.key]: value,
              }));
            }}
          />
        </AdminCard>
      ))}

      {canEdit && (
        <AdminCard title="변경 확인" description={`operation ${operationId}`}>
          <VStack gap="x4" alignItems="stretch">
            {changed.length === 0 ? (
              <Text color="fg.neutral-muted">변경한 설정이 없습니다.</Text>
            ) : (
              <VStack as="ul" gap="x2">
                {changed.map((item) => (
                  <Text as="li" key={item.key} textStyle="bodySm">
                    {item.key}: {item.value} → {draft[item.key]}
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
              onChange={(event) => setReason(event.currentTarget.value)}
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
        title={`${changed.length}개 설정을 변경할까요?`}
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

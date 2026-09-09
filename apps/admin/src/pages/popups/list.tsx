import type { AdminPopupNoticeOut } from "@essesion/api-client";
import {
  deleteAdminPopupMutation,
  listAdminPopupsOptions,
  listAdminPopupsQueryKey,
  updateAdminPopupMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Badge,
  HStack,
  Switch,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";

import { formatDate, getErrorMessage } from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { RouteHeading } from "../../shared/ui/route-heading";
import {
  AdminTable,
  type AdminTableColumn,
} from "../../widgets/admin-table/admin-table";
import { TEMPLATE_LABELS } from "./popup-form-model";

/** 지금 노출 중 / 활성인데 기간 밖 / 비활성 — 운영자가 "지금 뭐가 보이나"를 바로 알기 위한 표시. */
function PopupStatus({ row }: { row: AdminPopupNoticeOut }) {
  if (row.active_now) return <Badge tone="positive">노출 중</Badge>;
  if (!row.enabled) return <Badge>비활성</Badge>;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Badge tone="warning">{row.starts_on > today ? "대기" : "종료"}</Badge>
  );
}

export function PopupsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery(listAdminPopupsOptions());
  const [deleteTarget, setDeleteTarget] = useState<AdminPopupNoticeOut | null>(
    null,
  );

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: listAdminPopupsQueryKey() });

  const update = useMutation({
    ...updateAdminPopupMutation(),
    onSuccess: refresh,
    onError: (error) =>
      snackbar(getErrorMessage(error, "팝업을 바꾸지 못했습니다.")),
  });
  const remove = useMutation({
    ...deleteAdminPopupMutation(),
    onSuccess: async () => {
      setDeleteTarget(null);
      snackbar("팝업을 삭제했습니다.");
      await refresh();
    },
    onError: (error) =>
      snackbar(getErrorMessage(error, "팝업을 삭제하지 못했습니다.")),
  });

  const columns: readonly AdminTableColumn<AdminPopupNoticeOut>[] = [
    {
      key: "template",
      header: "템플릿",
      visibility: "medium",
      render: (row) => <Badge>{TEMPLATE_LABELS[row.template]}</Badge>,
    },
    {
      key: "title",
      header: "제목",
      render: (row) => (
        <Text textStyle="bodySm">
          {row.title}
          {row.title_emphasis ? ` ${row.title_emphasis}` : ""}
        </Text>
      ),
    },
    {
      key: "period",
      header: "노출 기간",
      visibility: "medium",
      render: (row) => (
        <Text textStyle="bodySm" color="fg.neutral-muted">
          {formatDate(row.starts_on)} ~ {formatDate(row.ends_on)}
        </Text>
      ),
    },
    {
      key: "status",
      header: "상태",
      render: (row) => <PopupStatus row={row} />,
    },
    {
      key: "enabled",
      header: "활성",
      render: (row) => (
        <Switch
          checked={row.enabled}
          aria-label={`${row.title} 활성`}
          onChange={(event) =>
            update.mutate({
              path: { popup_id: row.id },
              body: { enabled: event.target.checked },
            })
          }
        />
      ),
    },
    {
      key: "actions",
      header: "관리",
      align: "end",
      render: (row) => (
        <HStack gap="x2" justify="flex-end">
          <ActionButton
            variant="neutralWeak"
            size="small"
            onClick={() => navigate(`/popups/${row.id}/edit`)}
          >
            수정
          </ActionButton>
          <ActionButton
            variant="neutralOutline"
            size="small"
            onClick={() => setDeleteTarget(row)}
          >
            삭제
          </ActionButton>
        </HStack>
      ),
    },
  ];

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title="팝업 공지"
          description="store 첫 진입에 기간 한정으로 띄우는 안내입니다. 템플릿을 고르고 빈칸만 채우면 됩니다."
        />
        <ActionButton onClick={() => navigate("/popups/new")}>
          팝업 등록
        </ActionButton>
      </HStack>

      <AdminCard
        title="등록된 팝업"
        description="활성 스위치를 켠 팝업 중 노출 기간(KST) 안인 것 1개만 store에 보입니다. 기간이 지나면 자동으로 사라집니다."
        action={
          <ActionButton
            variant="neutralWeak"
            size="small"
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            새로고침
          </ActionButton>
        }
      >
        <AdminTable
          label="팝업 공지 목록"
          columns={columns}
          rows={query.data}
          getRowKey={(row) => row.id}
          status={
            query.isLoading ? "loading" : query.isError ? "error" : "success"
          }
          onRetry={() => void query.refetch()}
          emptyTitle="등록된 팝업이 없습니다"
          emptyDescription="팝업 등록 버튼으로 첫 안내를 만들어 주세요."
        />
      </AdminCard>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleteTarget(null);
        }}
        title="팝업을 삭제할까요?"
        description="store에서 즉시 사라집니다. 배너 이미지도 함께 정리됩니다."
        primaryActionProps={{
          children: "삭제",
          variant: "criticalSolid",
          loading: remove.isPending,
          onClick: (event) => {
            event.preventDefault();
            if (deleteTarget && !remove.isPending) {
              remove.mutate({ path: { popup_id: deleteTarget.id } });
            }
          },
        }}
        secondaryActionProps={{
          children: "취소",
          disabled: remove.isPending,
        }}
      />
    </VStack>
  );
}

import type { AdminDesignExampleOut } from "@essesion/api-client";
import {
  createAdminDesignExampleMutation,
  deleteAdminDesignExampleMutation,
  listAdminDesignExamplesOptions,
  listAdminDesignExamplesQueryKey,
  updateAdminDesignExampleMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Box,
  HStack,
  ImageFrame,
  Switch,
  snackbar,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { getErrorMessage } from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { NumberField } from "../../shared/ui/number-field";
import { RouteHeading } from "../../shared/ui/route-heading";
import {
  AdminTable,
  type AdminTableColumn,
} from "../../widgets/admin-table/admin-table";

/** 순서는 타자마다 저장하지 않는다 — 포커스를 잃을 때 바뀐 값만 PATCH한다. */
function OrdinalCell({
  row,
  onCommit,
}: {
  row: AdminDesignExampleOut;
  onCommit: (ordinal: number) => void;
}) {
  const [value, setValue] = useState(String(row.ordinal));
  return (
    <NumberField
      aria-label={`${row.name} 노출 순서`}
      value={value}
      onValueChange={setValue}
      onBlur={() => {
        const next = Number(value || 0);
        if (next !== row.ordinal) onCommit(next);
      }}
    />
  );
}

export function DesignExamplesPage() {
  const queryClient = useQueryClient();
  const query = useQuery(listAdminDesignExamplesOptions());
  const [runId, setRunId] = useState("");
  const [name, setName] = useState("");
  const [caption, setCaption] = useState("");
  const [ordinal, setOrdinal] = useState("");
  const [deleteTarget, setDeleteTarget] =
    useState<AdminDesignExampleOut | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: listAdminDesignExamplesQueryKey(),
    });

  const create = useMutation({
    ...createAdminDesignExampleMutation(),
    onSuccess: async () => {
      setRunId("");
      setName("");
      setCaption("");
      setOrdinal("");
      snackbar("예시를 등록했습니다. 게시하면 첫 진입 갤러리에 노출됩니다.");
      await refresh();
    },
    onError: (error) =>
      snackbar(getErrorMessage(error, "예시를 등록하지 못했습니다.")),
  });
  const update = useMutation({
    ...updateAdminDesignExampleMutation(),
    onSuccess: refresh,
    onError: (error) =>
      snackbar(getErrorMessage(error, "예시를 바꾸지 못했습니다.")),
  });
  const remove = useMutation({
    ...deleteAdminDesignExampleMutation(),
    onSuccess: async () => {
      setDeleteTarget(null);
      snackbar("예시를 삭제했습니다.");
      await refresh();
    },
    onError: (error) =>
      snackbar(getErrorMessage(error, "예시를 삭제하지 못했습니다.")),
  });

  const columns: readonly AdminTableColumn<AdminDesignExampleOut>[] = [
    {
      key: "preview",
      header: "미리보기",
      render: (row) => (
        <Box width={44}>
          <ImageFrame
            ratio={1}
            fit="cover"
            stroke
            src={`data:image/svg+xml;utf8,${encodeURIComponent(row.preview_svg)}`}
            alt={`${row.name} 미리보기`}
          />
        </Box>
      ),
    },
    {
      key: "name",
      header: "이름",
      render: (row) => (
        <VStack gap="x0_5" alignItems="stretch">
          <Text textStyle="bodySm">{row.name}</Text>
          <Text textStyle="caption" color="fg.neutral-muted">
            {row.caption ?? "설명 없음"}
          </Text>
        </VStack>
      ),
    },
    {
      key: "run_id",
      header: "run",
      visibility: "medium",
      render: (row) => row.run_id,
    },
    {
      key: "ordinal",
      header: "순서",
      align: "end",
      render: (row) => (
        <Box width={96} ml="auto">
          <OrdinalCell
            row={row}
            onCommit={(next) =>
              update.mutate({
                path: { example_id: row.id },
                body: { ordinal: next },
              })
            }
          />
        </Box>
      ),
    },
    {
      key: "published",
      header: "게시",
      render: (row) => (
        <Switch
          checked={row.published}
          aria-label={`${row.name} 게시`}
          onChange={(event) =>
            update.mutate({
              path: { example_id: row.id },
              body: { published: event.target.checked },
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
        <ActionButton
          variant="neutralOutline"
          size="small"
          onClick={() => setDeleteTarget(row)}
        >
          삭제
        </ActionButton>
      ),
    },
  ];

  return (
    <VStack gap="x6" alignItems="stretch">
      <RouteHeading
        title="디자인 예시"
        description="store 디자인 첫 진입 갤러리에 노출할 디자인을 큐레이션합니다. 고객이 고르면 토큰 없이 그 디자인에서 세션이 시작됩니다."
      />

      <AdminCard
        title="예시 등록"
        description="Seamless 로그에서 run ID를 복사해 등록합니다. 사용자가 올린 모티프를 쓰는 run은 등록할 수 없습니다."
      >
        <VStack
          as="form"
          gap="x4"
          alignItems="stretch"
          onSubmit={(event: React.FormEvent) => {
            event.preventDefault();
            create.mutate({
              body: {
                run_id: runId.trim(),
                name: name.trim(),
                caption: caption.trim() || null,
                ordinal: Number(ordinal || 0),
              },
            });
          }}
        >
          <HStack gap="x3" align="flex-start" wrap>
            <Box flex={1} minWidth={280}>
              <TextField
                label="run ID"
                placeholder="00000000-0000-0000-0000-000000000000"
                value={runId}
                onChange={(event) => setRunId(event.target.value)}
                required
              />
            </Box>
            <Box flex={1} minWidth={200}>
              <TextField
                label="갤러리 이름"
                placeholder="미드나잇 웨이브"
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </Box>
            <Box flex={1} minWidth={200}>
              <TextField
                label="카드 설명"
                description="카드 라벨 둘째 줄. 비우면 이름만 나옵니다."
                placeholder="네이비 · 대각 스트라이프"
                maxLength={60}
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
              />
            </Box>
            <Box width={140}>
              <NumberField
                label="노출 순서"
                value={ordinal}
                onValueChange={setOrdinal}
              />
            </Box>
          </HStack>
          <Box>
            <ActionButton type="submit" loading={create.isPending}>
              비게시로 등록
            </ActionButton>
          </Box>
        </VStack>
      </AdminCard>

      <AdminCard
        title="등록된 예시"
        description="게시 스위치를 켠 예시만 store 갤러리에 순서대로 노출됩니다."
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
          label="디자인 예시 목록"
          columns={columns}
          rows={query.data}
          getRowKey={(row) => row.id}
          status={
            query.isLoading ? "loading" : query.isError ? "error" : "success"
          }
          onRetry={() => void query.refetch()}
          emptyTitle="등록된 예시가 없습니다"
          emptyDescription="Seamless 로그에서 run ID를 복사해 등록해 주세요."
        />
      </AdminCard>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleteTarget(null);
        }}
        title="예시를 삭제할까요?"
        description="갤러리에서 즉시 사라집니다. 같은 run ID로 다시 등록할 수 있습니다."
        primaryActionProps={{
          children: "삭제",
          variant: "criticalSolid",
          loading: remove.isPending,
          onClick: (event) => {
            event.preventDefault();
            if (deleteTarget && !remove.isPending) {
              remove.mutate({ path: { example_id: deleteTarget.id } });
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

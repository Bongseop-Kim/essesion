import type { AdminDesignExampleOut } from "@essesion/api-client";
import {
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
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { getErrorMessage } from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { AppliedFilterBar } from "../../shared/ui/applied-filter-bar";
import { CompactFilterToolbar } from "../../shared/ui/compact-filter-toolbar";
import { FilterSelect } from "../../shared/ui/filter-select";
import { NumberField } from "../../shared/ui/number-field";
import { RouteHeading } from "../../shared/ui/route-heading";
import { SubmittedMemorySearch } from "../../shared/ui/submitted-memory-search";
import {
  AdminTable,
  type AdminTableColumn,
} from "../../widgets/admin-table/admin-table";

const PUBLISHED_LABELS = {
  all: "전체",
  published: "게시",
  unpublished: "미게시",
} as const;

type PublishedFilter = keyof typeof PUBLISHED_LABELS;

/** 순서는 타자마다 저장하지 않는다 — 포커스를 잃을 때 바뀐 값만 PATCH한다. */
function OrdinalCell({
  row,
  onCommit,
}: {
  row: AdminDesignExampleOut;
  onCommit: (ordinal: number) => Promise<unknown>;
}) {
  const [value, setValue] = useState(String(row.ordinal));
  const [seenOrdinal, setSeenOrdinal] = useState(row.ordinal);
  if (row.ordinal !== seenOrdinal) {
    setSeenOrdinal(row.ordinal);
    setValue(String(row.ordinal));
  }
  return (
    <NumberField
      aria-label={`${row.name} 노출 순서`}
      value={value}
      onValueChange={setValue}
      onBlur={() => {
        const next = Number(value || 0);
        if (next !== row.ordinal)
          onCommit(next).catch(() => setValue(String(row.ordinal)));
      }}
    />
  );
}

export function DesignExamplesPage() {
  const queryClient = useQueryClient();
  const query = useQuery(listAdminDesignExamplesOptions());
  const [search, setSearch] = useState<string>();
  const [searchResetKey, setSearchResetKey] = useState(0);
  const [published, setPublished] = useState<PublishedFilter>("all");
  const [draftPublished, setDraftPublished] =
    useState<PublishedFilter>(published);
  const [deleteTarget, setDeleteTarget] =
    useState<AdminDesignExampleOut | null>(null);

  const keyword = search?.toLocaleLowerCase("ko-KR");
  const filteredExamples = query.data?.filter((example) => {
    const matchesSearch =
      keyword === undefined ||
      [example.name, example.caption, example.run_id]
        .filter((value): value is string => value !== null)
        .some((value) => value.toLocaleLowerCase("ko-KR").includes(keyword));
    const matchesPublished =
      published === "all" || example.published === (published === "published");
    return matchesSearch && matchesPublished;
  });

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: listAdminDesignExamplesQueryKey(),
    });

  const update = useMutation({
    ...updateAdminDesignExampleMutation(),
    onSuccess: refresh,
    onError: (error) =>
      snackbar(
        getErrorMessage(
          error,
          "순서·게시 상태를 저장하지 못했습니다. 다시 시도해 주세요.",
        ),
      ),
  });
  const remove = useMutation({
    ...deleteAdminDesignExampleMutation(),
    onSuccess: async () => {
      setDeleteTarget(null);
      snackbar("템플릿을 삭제했습니다.");
      await refresh();
    },
    onError: (error) =>
      snackbar(
        getErrorMessage(
          error,
          "템플릿을 삭제하지 못했습니다. 다시 시도해 주세요.",
        ),
      ),
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
      header: "생성 실행 ID",
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
              update.mutateAsync({
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
  // 두 줄 목록도 표와 같은 컨트롤을 쓴다 — 열 렌더러를 그대로 가져온다
  const cell = (key: string, row: AdminDesignExampleOut) =>
    columns.find((column) => column.key === key)?.render(row);

  return (
    <VStack gap="x6" alignItems="stretch">
      <RouteHeading title="템플릿" />

      <AdminCard
        title="등록된 템플릿"
        description="게시 스위치를 켠 템플릿만 스토어 템플릿 목록에 순서대로 노출됩니다."
      >
        <VStack gap="x4" alignItems="stretch">
          <CompactFilterToolbar
            primaryControls={
              <SubmittedMemorySearch
                label="이름·설명·생성 실행 ID 검색"
                maxLength={100}
                resetKey={searchResetKey}
                onSubmit={setSearch}
              />
            }
            secondaryFilters={
              <FilterSelect
                label="게시 상태"
                presentation="inline"
                value={draftPublished}
                options={Object.entries(PUBLISHED_LABELS).map(
                  ([value, label]) => ({ value, label }),
                )}
                onValueChange={(value) =>
                  setDraftPublished(value as PublishedFilter)
                }
              />
            }
            secondaryFilterCount={Number(published !== "all")}
            secondaryTitle="템플릿 필터"
            onResetSecondaryFilters={() => setDraftPublished(published)}
            onApplySecondaryFilters={() => {
              setPublished(draftPublished);
              return undefined;
            }}
          />
          <AppliedFilterBar
            filters={[
              search !== undefined && {
                key: "search",
                label: `검색: ${search}`,
                onRemove: () => {
                  setSearch(undefined);
                  setSearchResetKey((current) => current + 1);
                },
              },
              published !== "all" && {
                key: "published",
                label: `게시 상태: ${PUBLISHED_LABELS[published]}`,
                onRemove: () => setPublished("all"),
              },
            ]}
            onReset={() => {
              setSearch(undefined);
              setSearchResetKey((current) => current + 1);
              setPublished("all");
            }}
          />
          <AdminTable
            label="템플릿 목록"
            columns={columns}
            rows={filteredExamples}
            getRowKey={(row) => row.id}
            compactRow={(row) => ({
              leading: cell("preview", row),
              title: row.name,
              trailing: cell("published", row),
              meta: row.caption ?? "설명 없음",
              status: (
                <HStack gap="x2" className="shrink-0">
                  {cell("ordinal", row)}
                  {cell("actions", row)}
                </HStack>
              ),
            })}
            status={
              query.isLoading ? "loading" : query.isError ? "error" : "success"
            }
            onRetry={() => void query.refetch()}
            emptyTitle="조건에 맞는 템플릿이 없습니다"
          />
        </VStack>
      </AdminCard>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleteTarget(null);
        }}
        title="템플릿을 삭제할까요?"
        description="스토어 템플릿 목록에서 바로 사라집니다."
        primaryActionProps={{
          children: "템플릿 삭제",
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

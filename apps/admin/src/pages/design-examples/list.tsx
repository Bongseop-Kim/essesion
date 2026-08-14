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
import { useNavigate } from "react-router";

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
  unpublished: "비게시",
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
  const navigate = useNavigate();
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

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title="디자인 예시"
          description="store 디자인 첫 진입 갤러리에 노출할 디자인을 큐레이션합니다. 고객이 고르면 토큰 없이 그 디자인에서 세션이 시작됩니다."
        />
        <ActionButton onClick={() => navigate("/design-examples/new")}>
          예시 등록
        </ActionButton>
      </HStack>

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
        <VStack gap="x4" alignItems="stretch">
          <CompactFilterToolbar
            primaryControls={
              <SubmittedMemorySearch
                label="이름·설명·run ID 검색"
                placeholder="2자 이상 입력"
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
            secondaryTitle="디자인 예시 필터"
            secondaryDescription="게시 상태를 골라 적용합니다."
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
            label="디자인 예시 목록"
            columns={columns}
            rows={filteredExamples}
            getRowKey={(row) => row.id}
            status={
              query.isLoading ? "loading" : query.isError ? "error" : "success"
            }
            onRetry={() => void query.refetch()}
            emptyTitle="조건에 맞는 디자인 예시가 없습니다"
            emptyDescription="검색어나 게시 상태를 바꿔 다시 확인해 주세요."
          />
        </VStack>
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

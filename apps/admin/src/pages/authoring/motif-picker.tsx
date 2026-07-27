import type { MotifSummaryOut } from "@essesion/api-client";
import { listAdminMotifsOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  Box,
  ContentPlaceholder,
  FieldButton,
  HStack,
  ResponsiveModal,
  SelectBox,
  SelectBoxItem,
  Skeleton,
  TextField,
  VStack,
} from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";

/** 서버 계약(DesignPlanV3)의 모티프 슬롯 상한 */
const MAX_MOTIFS = 2;

export function motifLabel(motif: MotifSummaryOut) {
  return motif.subject?.trim() || motif.id;
}

/* FieldButton(트리거) + ResponsiveModal(모바일 시트↔PC 모달) + SelectBox 다중 선택.
   ListPicker는 단일 선택 전용이라 최대 2개 다중 선택에는 쓸 수 없어 같은 레시피로 조합했다. */
export function MotifPicker({
  value,
  labels,
  onChange,
  disabled,
}: {
  value: string[];
  /** 알고 있는 id→이름. 편집 진입 시에는 비어 있어 ID를 그대로 보여준다 */
  labels: Record<string, string>;
  onChange: (value: string[], labels: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState(value);
  const query = useQuery({
    ...listAdminMotifsOptions({
      query: { q: search.trim() || undefined, limit: 100, offset: 0 },
    }),
    placeholderData: keepPreviousData,
    enabled: open,
  });

  const label = (id: string) => labels[id] ?? id;

  return (
    <>
      <FieldButton
        label={`모티프 (${value.length}/${MAX_MOTIFS})`}
        description="고른 순서가 Plan JSON의 motifs[].input_index(1부터)입니다. 카탈로그 모티프만 사용하며 생성형 호출은 하지 않습니다."
        placeholder="모티프 선택"
        value={
          value.length === 0
            ? undefined
            : value.map((id, index) => `${index + 1}. ${label(id)}`).join(" · ")
        }
        disabled={disabled}
        onClick={() => {
          setDraft(value);
          setOpen(true);
        }}
      />
      {open && (
        <ResponsiveModal
          open
          onOpenChange={setOpen}
          title="모티프 선택"
          description={`Plan의 모티프 슬롯 순서대로 최대 ${MAX_MOTIFS}개까지 고릅니다.`}
          size="medium"
          showCloseButton
          footer={
            <HStack gap="x2" justify="flex-end" wrap>
              <ActionButton
                variant="neutralOutline"
                onClick={() => setDraft([])}
                disabled={draft.length === 0}
              >
                선택 해제
              </ActionButton>
              <ActionButton
                variant="brandSolid"
                onClick={() => {
                  const found = query.data?.items ?? [];
                  onChange(draft, {
                    ...labels,
                    ...Object.fromEntries(
                      found.map((motif) => [motif.id, motifLabel(motif)]),
                    ),
                  });
                  setOpen(false);
                }}
              >
                {draft.length === 0 ? "모티프 없이 사용" : "선택 완료"}
              </ActionButton>
            </HStack>
          }
        >
          <VStack gap="x4" alignItems="stretch">
            <TextField
              label="모티프 검색"
              placeholder="이름 또는 ID"
              value={search}
              maxLength={100}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
            <Box maxHeight={360} overflowY="auto">
              {query.isLoading ? (
                <VStack gap="x3" alignItems="stretch" aria-busy="true">
                  <Skeleton preset="line" />
                  <Skeleton preset="line" />
                  <Skeleton preset="line" />
                </VStack>
              ) : query.isError ? (
                <ContentPlaceholder
                  title="모티프를 불러오지 못했습니다"
                  action={
                    <ActionButton onClick={() => void query.refetch()}>
                      다시 시도
                    </ActionButton>
                  }
                />
              ) : query.data?.items.length === 0 ? (
                <ContentPlaceholder title="조건에 맞는 모티프가 없습니다" />
              ) : (
                <SelectBox
                  multiple
                  value={draft}
                  aria-label="모티프 목록"
                  onValueChange={(next) =>
                    setDraft(
                      (Array.isArray(next) ? next : [next]).slice(
                        0,
                        MAX_MOTIFS,
                      ),
                    )
                  }
                >
                  {query.data?.items.map((motif) => (
                    <SelectBoxItem
                      key={motif.id}
                      value={motif.id}
                      label={motifLabel(motif)}
                      description={`${motif.id} · ${motif.color_slot_count}색 슬롯`}
                      disabled={
                        draft.length >= MAX_MOTIFS && !draft.includes(motif.id)
                      }
                    />
                  ))}
                </SelectBox>
              )}
            </Box>
          </VStack>
        </ResponsiveModal>
      )}
    </>
  );
}

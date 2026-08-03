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
import { useDeferredValue, useState } from "react";

/** 서버 계약(DesignPlanV3)의 모티프 개수 상한 */
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
  max = MAX_MOTIFS,
  label = "모티프",
  description = "고른 순서가 Plan JSON의 motifs[].input_index(1부터)입니다. 카탈로그 모티프만 사용하며 생성형 호출은 하지 않습니다.",
}: {
  value: string[];
  /** 알고 있는 id→이름. 편집 진입 시에는 비어 있어 ID를 그대로 보여준다 */
  labels: Record<string, string>;
  onChange: (value: string[], labels: Record<string, string>) => void;
  disabled?: boolean;
  /** 고를 수 있는 개수 상한 — 기본은 Plan 계약 상한(2) */
  max?: number;
  label?: string;
  description?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  // 타이핑마다 요청하지 않도록 검색어만 지연시킨다 — 입력 표시는 즉시.
  const deferredSearch = useDeferredValue(search);
  const [draft, setDraft] = useState(value);
  // 서버 q는 2자 이상만 받는다 — 1자는 검색어 없이 조회한다.
  const trimmedSearch = deferredSearch.trim();
  const query = useQuery({
    ...listAdminMotifsOptions({
      query: {
        q: trimmedSearch.length >= 2 ? trimmedSearch : undefined,
        limit: 100,
        offset: 0,
      },
    }),
    placeholderData: keepPreviousData,
    enabled: open,
  });

  const labelFor = (id: string) => labels[id] ?? id;

  return (
    <>
      <FieldButton
        label={`${label} (${value.length}/${max})`}
        description={description}
        placeholder="모티프 선택"
        value={
          value.length === 0
            ? undefined
            : value
                .map((id, index) => `${index + 1}. ${labelFor(id)}`)
                .join(" · ")
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
          description={`Plan의 모티프 순서대로 최대 ${max}개까지 고릅니다.`}
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
                      (Array.isArray(next) ? next : [next]).slice(0, max),
                    )
                  }
                >
                  {query.data?.items.map((motif) => (
                    <SelectBoxItem
                      key={motif.id}
                      value={motif.id}
                      label={motifLabel(motif)}
                      // subject가 없으면 label이 이미 id다 — 같은 줄을 두 번 보여주지 않는다.
                      description={motif.subject?.trim() ? motif.id : undefined}
                      disabled={
                        draft.length >= max && !draft.includes(motif.id)
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

import type { GenerationJobOut } from "@essesion/api-client";
import { ActionButton, Box, FieldButton, Modal } from "@essesion/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useAuthGuard } from "@/features/auth/ui/auth-guard-provider";
import { finalizedJobsInfiniteQueryOptions } from "@/features/design/model/queries";
import { FinalizedGallery } from "@/features/design/ui/finalized-gallery";
import { formatDateTime } from "@/shared/lib/format";
import { useSession } from "@/shared/store/session";

/** FieldButton의 값 표시용 짧은 형식 — 목록 카드는 갤러리의 긴 형식을 쓴다. */
const formatDate = (value: string) =>
  formatDateTime(
    value,
    { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
    "완성 디자인",
  );

export type DesignPickerProps = {
  selected: GenerationJobOut | null;
  onChange: (selected: GenerationJobOut | null) => void;
  disabled?: boolean;
};

export function DesignPicker({
  selected,
  onChange,
  disabled = false,
}: DesignPickerProps) {
  const [open, setOpen] = useState(false);
  const status = useSession((state) => state.status);
  const { requireAuth } = useAuthGuard();
  // 디자인 페이지의 완성본 모달과 같은 무한 쿼리 — 캐시를 공유하고 100개 절단이 없다.
  const jobsQuery = useInfiniteQuery(
    finalizedJobsInfiniteQueryOptions(open && status === "authenticated"),
  );

  const handleOpen = () => {
    if (!requireAuth({ path: "/custom-order" })) return;
    setOpen(true);
  };

  const toggle = (job: GenerationJobOut) => {
    onChange(selected?.id === job.id ? null : job);
    setOpen(false);
  };

  return (
    <>
      <FieldButton
        label="AI 디자인"
        description="실사화를 마친 내 디자인을 참고 이미지로 가져올 수 있어요."
        placeholder="내 AI 디자인에서 선택"
        value={selected ? formatDate(selected.created_at) : undefined}
        disabled={disabled || status === "loading"}
        onClick={handleOpen}
      />
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="내 AI 디자인"
        description="완성한 디자인 중 1개를 선택할 수 있어요."
        showCloseButton
        footer={
          <Box
            as={ActionButton}
            type="button"
            width="full"
            onClick={() => setOpen(false)}
          >
            닫기
          </Box>
        }
      >
        <FinalizedGallery
          variant="select"
          selectedId={selected?.id ?? null}
          onSelect={toggle}
          jobs={jobsQuery.data?.pages.flat() ?? []}
          loading={jobsQuery.isPending}
          error={jobsQuery.isError}
          onRetry={() => void jobsQuery.refetch()}
          hasMore={jobsQuery.hasNextPage}
          loadingMore={jobsQuery.isFetchingNextPage}
          loadMoreError={jobsQuery.isFetchNextPageError}
          onLoadMore={() => void jobsQuery.fetchNextPage()}
        />
      </Modal>
    </>
  );
}

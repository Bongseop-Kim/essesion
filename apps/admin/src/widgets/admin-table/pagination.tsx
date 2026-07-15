import { ActionButton, Box, HStack, Text, VStack } from "@essesion/shared";

import { FilterSelect } from "../../shared/ui/filter-select";

export type PaginationProps = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  label?: string;
  total?: number;
  limit?: number;
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (pageSize: number) => void;
};

export function getVisiblePages(page: number, totalPages: number) {
  const visibleCount = Math.min(5, totalPages);
  const maxStart = Math.max(1, totalPages - visibleCount + 1);
  const start = Math.min(maxStart, Math.max(1, page - 2));
  return Array.from({ length: visibleCount }, (_, index) => start + index);
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  label = "페이지 이동",
  total,
  limit,
  pageSizeOptions,
  onPageSizeChange,
}: PaginationProps) {
  const showSummary = total !== undefined && limit !== undefined;
  const showPageSizeControl =
    limit !== undefined &&
    pageSizeOptions !== undefined &&
    pageSizeOptions.length > 0 &&
    onPageSizeChange !== undefined;

  if (totalPages <= 1 && !showSummary && !showPageSizeControl) return null;

  const normalizedPage = Math.min(Math.max(page, 1), Math.max(totalPages, 1));
  const rangeStart = showSummary
    ? total === 0
      ? 0
      : (normalizedPage - 1) * limit + 1
    : 0;
  const rangeEnd = showSummary ? Math.min(normalizedPage * limit, total) : 0;

  return (
    <VStack gap="x3" alignItems="stretch">
      {(showSummary || showPageSizeControl) && (
        <HStack
          justify={showSummary ? "space-between" : "flex-end"}
          gap="x2"
          wrap
        >
          {showSummary && (
            <Text
              role="status"
              aria-live="polite"
              aria-atomic="true"
              textStyle="caption"
              color="fg.neutral-muted"
            >
              {rangeStart}–{rangeEnd} / 총 {total}건
            </Text>
          )}
          {showPageSizeControl ? (
            <FilterSelect
              label="페이지당 표시"
              value={String(limit)}
              options={pageSizeOptions.map((pageSize) => ({
                value: String(pageSize),
                label: `${pageSize}개`,
              }))}
              onValueChange={(value) => onPageSizeChange(Number(value))}
            />
          ) : showSummary ? (
            <Text textStyle="caption" color="fg.neutral-muted">
              페이지당 {limit}개
            </Text>
          ) : null}
        </HStack>
      )}
      {totalPages > 1 && (
        <Box as="nav" aria-label={label}>
          <HStack justify="center" gap="x1" wrap>
            <ActionButton
              variant="ghost"
              size="small"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              이전
            </ActionButton>
            {getVisiblePages(page, totalPages).map((pageNumber) => {
              const current = pageNumber === page;
              return (
                <ActionButton
                  key={pageNumber}
                  variant={current ? "neutralWeak" : "ghost"}
                  size="small"
                  aria-label={`${pageNumber}페이지`}
                  aria-current={current ? "page" : undefined}
                  disabled={current}
                  onClick={() => onPageChange(pageNumber)}
                >
                  <Text as="span" textStyle="labelSm">
                    {pageNumber}
                  </Text>
                </ActionButton>
              );
            })}
            <ActionButton
              variant="ghost"
              size="small"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              다음
            </ActionButton>
          </HStack>
        </Box>
      )}
    </VStack>
  );
}

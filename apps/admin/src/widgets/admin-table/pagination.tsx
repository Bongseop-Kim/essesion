import { ActionButton, Box, HStack, Text } from "@essesion/shared";

export type PaginationProps = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  label?: string;
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
}: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
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
  );
}

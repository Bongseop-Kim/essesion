import {
  ActionButton,
  Box,
  ContentPlaceholder,
  cn,
  HStack,
  Icon,
  ScrollFog,
  Skeleton,
  Text,
} from "@essesion/shared";
import {
  ChevronDownIcon,
  ChevronUpDownIcon,
  ChevronUpIcon,
} from "@heroicons/react/20/solid";
import type { MouseEvent, ReactNode } from "react";

export type AdminTableSort = {
  key: string;
  direction: "asc" | "desc";
};

export type AdminTableColumn<Row> = {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  sortable?: boolean;
  align?: "start" | "end";
  visibility?: "always" | "medium" | "large";
};

export type AdminTableProps<Row> = {
  label: string;
  columns: readonly AdminTableColumn<Row>[];
  rows?: readonly Row[];
  getRowKey: (row: Row) => string;
  status: "loading" | "success" | "error";
  total?: number;
  sort?: AdminTableSort;
  onSort?: (sort: AdminTableSort) => void;
  onRowClick?: (row: Row) => void;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  errorDescription?: string;
};

const visibilityClasses = {
  always: undefined,
  medium: "hidden md:table-cell",
  large: "hidden lg:table-cell",
} as const;

function nextSort(current: AdminTableSort | undefined, key: string) {
  if (current?.key !== key) return { key, direction: "asc" } as const;
  return {
    key,
    direction: current.direction === "asc" ? "desc" : "asc",
  } as const;
}

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction?: "asc" | "desc";
}) {
  const svg = active ? (
    direction === "asc" ? (
      <ChevronUpIcon />
    ) : (
      <ChevronDownIcon />
    )
  ) : (
    <ChevronUpDownIcon />
  );
  return <Icon svg={svg} size={16} />;
}

export function AdminTable<Row>({
  label,
  columns,
  rows = [],
  getRowKey,
  status,
  total = rows.length,
  sort,
  onSort,
  onRowClick,
  onRetry,
  emptyTitle = "표시할 데이터가 없습니다",
  emptyDescription,
  errorDescription = "데이터를 불러오지 못했습니다.",
}: AdminTableProps<Row>) {
  if (status === "error") {
    return (
      <ContentPlaceholder
        title="목록을 불러오지 못했습니다"
        description={errorDescription}
        action={
          onRetry === undefined ? undefined : (
            <ActionButton variant="neutralWeak" onClick={onRetry}>
              다시 시도
            </ActionButton>
          )
        }
      />
    );
  }

  if (status === "success" && rows.length === 0) {
    return (
      <ContentPlaceholder title={emptyTitle} description={emptyDescription} />
    );
  }

  const loadingRows = Array.from({ length: 5 }, (_, index) => index);
  const resultMessage =
    status === "loading" ? `${label} 불러오는 중` : `총 ${total}건`;

  return (
    <Box minWidth={0} aria-busy={status === "loading" || undefined}>
      <Text
        as="span"
        textStyle="caption"
        className="sr-only"
        aria-live="polite"
      >
        {resultMessage}
      </Text>
      <ScrollFog
        direction="horizontal"
        role="region"
        tabIndex={0}
        aria-label={`${label} 표 가로 스크롤 영역`}
      >
        <Box
          as="table"
          width="full"
          minWidth={720}
          bg="bg.layer-default"
          className="border-collapse"
        >
          <Text as="caption" textStyle="caption" className="sr-only">
            {label}
          </Text>
          <Box as="thead" bg="bg.neutral-weak">
            <Box as="tr">
              {columns.map((column) => {
                const active = sort?.key === column.key;
                const ariaSort = active
                  ? sort.direction === "asc"
                    ? "ascending"
                    : "descending"
                  : "none";
                const visibility = column.visibility ?? "always";
                return (
                  <Box
                    as="th"
                    key={column.key}
                    scope="col"
                    aria-sort={column.sortable ? ariaSort : undefined}
                    px="x3"
                    py="x2_5"
                    className={cn(
                      "border-b border-stroke-neutral-weak",
                      visibilityClasses[visibility],
                      column.align === "end" && "text-right tabular-nums",
                    )}
                  >
                    {column.sortable && onSort !== undefined ? (
                      <ActionButton
                        variant="ghost"
                        size="xsmall"
                        aria-label={`${column.header} 정렬`}
                        onClick={() => onSort(nextSort(sort, column.key))}
                      >
                        <HStack gap="x1">
                          <Text as="span" textStyle="labelSm">
                            {column.header}
                          </Text>
                          <SortIcon
                            active={active}
                            direction={active ? sort.direction : undefined}
                          />
                        </HStack>
                      </ActionButton>
                    ) : (
                      <Text as="span" textStyle="labelSm">
                        {column.header}
                      </Text>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>
          <Box as="tbody">
            {status === "loading"
              ? loadingRows.map((row) => (
                  <Box as="tr" key={row}>
                    {columns.map((column) => (
                      <Box
                        as="td"
                        key={column.key}
                        px="x3"
                        py="x3"
                        className={cn(
                          "border-b border-stroke-neutral-weak",
                          visibilityClasses[column.visibility ?? "always"],
                        )}
                      >
                        <Skeleton width="100%" height={20} />
                      </Box>
                    ))}
                  </Box>
                ))
              : rows.map((row) => (
                  <Box
                    as="tr"
                    key={getRowKey(row)}
                    onClick={
                      onRowClick === undefined
                        ? undefined
                        : (event: MouseEvent<HTMLTableRowElement>) => {
                            const target = event.target as Element;
                            if (
                              target.closest(
                                "a,button,input,label,select,textarea",
                              )
                            ) {
                              return;
                            }
                            if (window.getSelection()?.isCollapsed === false) {
                              return;
                            }
                            onRowClick(row);
                          }
                    }
                    className={cn(
                      onRowClick !== undefined &&
                        "cursor-pointer hover:bg-bg-neutral-weak",
                    )}
                  >
                    {columns.map((column) => (
                      <Box
                        as="td"
                        key={column.key}
                        px="x3"
                        py="x3"
                        className={cn(
                          "border-b border-stroke-neutral-weak",
                          visibilityClasses[column.visibility ?? "always"],
                          column.align === "end" && "text-right tabular-nums",
                        )}
                      >
                        {column.render(row)}
                      </Box>
                    ))}
                  </Box>
                ))}
          </Box>
        </Box>
      </ScrollFog>
    </Box>
  );
}

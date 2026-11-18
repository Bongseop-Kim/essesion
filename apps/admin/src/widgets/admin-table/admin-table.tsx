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
  useBreakpoint,
  VStack,
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

/** md 미만에서 표 대신 그리는 두 줄 행 — 윗줄 제목·값, 아랫줄 보조 정보·상태. */
export type AdminTableCompactRow = {
  /** 두 줄 왼쪽에 세로로 걸치는 자리 — 미리보기 이미지·선택 체크박스. */
  leading?: ReactNode;
  title: ReactNode;
  trailing?: ReactNode;
  meta?: ReactNode;
  status?: ReactNode;
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
  /**
   * 지정하면 md 미만에서 표 대신 촘촘한 목록으로 그린다. 표는 열이 3개만 넘어도 휴대폰 폭을
   * 넘겨 금액·상태가 가로 스크롤 뒤로 숨는다.
   */
  compactRow?: (row: Row) => AdminTableCompactRow;
  onRetry?: () => void;
  /**
   * 다른 카드와 함께 쌓이는 카드 안의 표(대시보드·상세)는 빈 상태를 한두 줄로 줄인다.
   * 목록이 화면의 주인공인 페이지는 기본값(ContentPlaceholder)을 쓴다.
   */
  compactEmpty?: boolean;
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
  compactRow,
  onRetry,
  compactEmpty = false,
  emptyTitle = "표시할 데이터가 없습니다",
  emptyDescription,
  errorDescription = "잠시 후 다시 시도해 주세요.",
}: AdminTableProps<Row>) {
  const breakpoint = useBreakpoint();
  const compact = breakpoint === "base" || breakpoint === "sm";
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
    if (!compactEmpty) {
      return (
        <ContentPlaceholder title={emptyTitle} description={emptyDescription} />
      );
    }
    return (
      <Box py="x2">
        <Text textStyle="bodySm" color="fg.neutral-muted">
          {emptyTitle}
        </Text>
        {emptyDescription !== undefined && (
          <Text textStyle="caption" color="fg.neutral-muted">
            {emptyDescription}
          </Text>
        )}
      </Box>
    );
  }

  const sortableColumns =
    onSort === undefined ? [] : columns.filter((column) => column.sortable);
  const sortButton = (column: AdminTableColumn<Row>, className?: string) => {
    const active = sort?.key === column.key;
    return (
      <ActionButton
        key={column.key}
        variant="ghost"
        size="xsmall"
        aria-label={`${column.header} 정렬`}
        className={className}
        onClick={() => onSort?.(nextSort(sort, column.key))}
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
    );
  };
  const compactList =
    compactRow !== undefined && compact && status === "success" ? (
      <VStack
        as="ul"
        aria-label={label}
        gap={0}
        alignItems="stretch"
        className="m-0 list-none p-0"
      >
        {rows.map((row) => {
          const item = compactRow(row);
          return (
            <Box
              as="li"
              key={getRowKey(row)}
              className="border-t border-stroke-neutral-weak"
            >
              <HStack
                as={onRowClick === undefined ? "div" : "button"}
                {...(onRowClick !== undefined && {
                  type: "button",
                  onClick: () => onRowClick(row),
                })}
                width="full"
                gap="x3"
                py="x1_5"
                className="text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
              >
                {item.leading !== undefined && (
                  <Box className="shrink-0">{item.leading}</Box>
                )}
                <VStack flex={1} minWidth={0} gap="x0_5" alignItems="stretch">
                  <HStack justify="space-between" gap="x3">
                    <Text textStyle="labelSm" maxLines={1}>
                      {item.title}
                    </Text>
                    <Text textStyle="labelSm" className="shrink-0 tabular-nums">
                      {item.trailing}
                    </Text>
                  </HStack>
                  <HStack justify="space-between" gap="x3">
                    <Text
                      textStyle="caption"
                      color="fg.neutral-muted"
                      maxLines={1}
                    >
                      {item.meta}
                    </Text>
                    {item.status}
                  </HStack>
                </VStack>
              </HStack>
            </Box>
          );
        })}
      </VStack>
    ) : null;

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
      {compactList !== null && sortableColumns.length > 0 && (
        // 두 줄 목록에는 표 머리글이 없다 — 정렬 버튼만 목록 위에 남긴다
        <HStack gap="x1" wrap pb="x1">
          {sortableColumns.map((column) => sortButton(column))}
        </HStack>
      )}
      {compactList ?? (
        <ScrollFog
          role="region"
          tabIndex={0}
          aria-label={`${label} 표 가로 스크롤 영역`}
        >
          <Box
            as="table"
            width="full"
            // md 미만은 always 열만 남으므로 화면 폭에 맞춘다 — 720을 강제하면 금액·상태가 스크롤 뒤로 숨는다
            minWidth={{ base: 0, md: 720 }}
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
                        "border-b border-stroke-neutral-weak text-left",
                        visibilityClasses[visibility],
                        column.align === "end" && "text-right tabular-nums",
                      )}
                    >
                      {column.sortable && onSort !== undefined ? (
                        sortButton(column, "-mx-x3")
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
                              if (
                                window.getSelection()?.isCollapsed === false
                              ) {
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
                          {/* admin 표 본문은 bodySm(14px) — 16px이면 1280에서도 날짜·번호가 줄바꿈된다 */}
                          <Text as="div" textStyle="bodySm">
                            {column.render(row)}
                          </Text>
                        </Box>
                      ))}
                    </Box>
                  ))}
            </Box>
          </Box>
        </ScrollFog>
      )}
    </Box>
  );
}

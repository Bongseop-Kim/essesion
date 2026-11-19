import { Divider, Text, VStack } from "@essesion/shared";
import type { ReactNode } from "react";

import { AdminCard } from "../../shared/ui/admin-card";
import {
  AdminTable,
  type AdminTableColumn,
  type AdminTableCompactRow,
  type AdminTableSort,
} from "./admin-table";
import { Pagination } from "./pagination";

// 제목은 페이지 RouteHeading 하나만 — 카드는 건수와 새로고침만 둔다.
type PaginatedAdminTableCardProps<Row> = {
  description?: string;
  label: string;
  columns: readonly AdminTableColumn<Row>[];
  rows?: readonly Row[];
  getRowKey: (row: Row) => string;
  status: "loading" | "success" | "error";
  total?: number;
  limit?: number;
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (pageSize: number) => void;
  sort?: AdminTableSort;
  onSort?: (sort: AdminTableSort) => void;
  onRowClick?: (row: Row) => void;
  compactRow?: (row: Row) => AdminTableCompactRow;
  onRetry: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  errorDescription?: string;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  paginationLabel: string;
  toolbar?: ReactNode;
};

export function PaginatedAdminTableCard<Row>({
  description,
  label,
  columns,
  rows,
  getRowKey,
  status,
  total,
  limit,
  pageSizeOptions,
  onPageSizeChange,
  sort,
  onSort,
  onRowClick,
  compactRow,
  onRetry,
  emptyTitle,
  emptyDescription,
  errorDescription,
  page,
  totalPages,
  onPageChange,
  paginationLabel,
  toolbar,
}: PaginatedAdminTableCardProps<Row>) {
  return (
    <AdminCard>
      <VStack gap="x4" alignItems="stretch">
        {status === "success" && description !== undefined ? (
          <Text textStyle="bodySm" color="fg.neutral-muted">
            {description}
          </Text>
        ) : null}
        {toolbar !== undefined ? (
          <VStack gap="x3" alignItems="stretch">
            {toolbar}
            <Divider />
          </VStack>
        ) : null}
        <AdminTable
          label={label}
          columns={columns}
          rows={rows}
          getRowKey={getRowKey}
          status={status}
          total={total}
          sort={sort}
          onSort={onSort}
          onRowClick={onRowClick}
          compactRow={compactRow}
          onRetry={onRetry}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          errorDescription={errorDescription}
        />
        {status === "success" && (total ?? 0) > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
            label={paginationLabel}
            total={total}
            limit={limit}
            pageSizeOptions={pageSizeOptions}
            onPageSizeChange={onPageSizeChange}
          />
        )}
      </VStack>
    </AdminCard>
  );
}

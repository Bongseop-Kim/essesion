import { ActionButton, Divider, VStack } from "@essesion/shared";
import type { ReactNode } from "react";

import { AdminCard } from "../../shared/ui/admin-card";
import {
  AdminTable,
  type AdminTableColumn,
  type AdminTableSort,
} from "./admin-table";
import { Pagination } from "./pagination";

type PaginatedAdminTableCardProps<Row> = {
  title: string;
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
  refreshing: boolean;
  onRefresh: () => void;
  onRetry?: () => void;
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
  title,
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
  refreshing,
  onRefresh,
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
    <AdminCard
      title={title}
      description={status === "success" ? description : undefined}
      action={
        <ActionButton
          variant="ghost"
          size="small"
          loading={refreshing}
          onClick={onRefresh}
        >
          새로고침
        </ActionButton>
      }
    >
      <VStack gap="x4" alignItems="stretch">
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
          onRetry={onRetry ?? onRefresh}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          errorDescription={errorDescription}
        />
        {status === "success" && (
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

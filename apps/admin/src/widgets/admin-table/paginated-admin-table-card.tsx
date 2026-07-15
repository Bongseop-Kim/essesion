import { ActionButton, VStack } from "@essesion/shared";

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
}: PaginatedAdminTableCardProps<Row>) {
  return (
    <AdminCard
      title={title}
      description={description}
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
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={onPageChange}
          label={paginationLabel}
        />
      </VStack>
    </AdminCard>
  );
}

import type { PaymentIncidentSummaryOut } from "@essesion/api-client";
import { adminListPaymentIncidentsOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  HStack,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";

import { formatDateTime, formatMoney } from "../../shared/lib/format";
import {
  parseAdminListQuery,
  serializeAdminListQuery,
} from "../../shared/lib/url-query";
import { AdminCard } from "../../shared/ui/admin-card";
import { FilterSelect } from "../../shared/ui/filter-select";
import { RouteHeading } from "../../shared/ui/route-heading";
import { StatusBadge } from "../../shared/ui/status-badge";
import {
  AdminTable,
  type AdminTableColumn,
} from "../../widgets/admin-table/admin-table";
import { Pagination } from "../../widgets/admin-table/pagination";

const INCIDENT_TYPES = [
  { value: "all", label: "전체" },
  { value: "confirm", label: "결제 승인" },
  { value: "refund", label: "환불" },
  { value: "partial_cancel", label: "부분 취소" },
  { value: "mixed_state", label: "상태 불일치" },
  { value: "amount_mismatch", label: "금액 불일치" },
] as const;

const INCIDENT_STATUSES = ["all", "open", "resolved"] as const;
const INCIDENT_SORTS = [
  "created_at",
  "updated_at",
  "status",
  "incident_type",
] as const;

type IncidentType = (typeof INCIDENT_TYPES)[number]["value"];
type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
type IncidentSort = (typeof INCIDENT_SORTS)[number];

function incidentTypeLabel(type: string) {
  return INCIDENT_TYPES.find((item) => item.value === type)?.label ?? type;
}

const columns: readonly AdminTableColumn<PaymentIncidentSummaryOut>[] = [
  {
    key: "incident_type",
    header: "유형",
    sortable: true,
    render: (incident) => (
      <Link to={`/incidents/${incident.id}`}>
        {incidentTypeLabel(incident.incident_type)}
      </Link>
    ),
  },
  {
    key: "status",
    header: "상태",
    sortable: true,
    render: (incident) => <StatusBadge status={incident.status} />,
  },
  {
    key: "related",
    header: "관련 리소스",
    render: (incident) => (
      <VStack gap="x0_5">
        {incident.order_id !== null ? (
          <Link to={`/orders/${incident.order_id}`}>주문 보기</Link>
        ) : (
          <Text textStyle="caption" color="fg.neutral-muted">
            연결 주문 없음
          </Text>
        )}
        {incident.claim_id !== null && (
          <Link to={`/claims/${incident.claim_id}`}>클레임 보기</Link>
        )}
      </VStack>
    ),
  },
  {
    key: "amount",
    header: "기대 / 확인 금액",
    align: "end",
    visibility: "medium",
    render: (incident) =>
      `${formatMoney(incident.expected_amount)} / ${formatMoney(incident.observed_amount)}`,
  },
  {
    key: "created_at",
    header: "발생일",
    sortable: true,
    visibility: "large",
    render: (incident) => formatDateTime(incident.created_at),
  },
];

export function IncidentsPage() {
  const [params, setParams] = useSearchParams();
  const parsed = parseAdminListQuery(params, {
    allowedSorts: INCIDENT_SORTS,
    allowedStatuses: INCIDENT_STATUSES,
    allowedTypes: INCIDENT_TYPES.map((item) => item.value),
    defaultSort: "created_at",
    defaultDirection: "desc",
  });
  const incidentType = (parsed.type ?? "all") as IncidentType;
  const status = (parsed.status ?? "open") as IncidentStatus;
  const sort = (parsed.sort ?? "created_at") as IncidentSort;

  const query = useQuery({
    ...adminListPaymentIncidentsOptions({
      query: {
        incident_type: incidentType,
        status,
        start_date: parsed.from,
        end_date: parsed.to,
        sort,
        direction: parsed.direction,
        limit: parsed.limit,
        offset: (parsed.page - 1) * parsed.limit,
      },
    }),
    placeholderData: keepPreviousData,
    refetchInterval: status === "resolved" ? false : 30_000,
  });

  const replaceQuery = (changes: Partial<typeof parsed>) => {
    setParams(serializeAdminListQuery({ ...parsed, ...changes }), {
      replace: true,
    });
  };

  const totalPages = Math.max(
    1,
    Math.ceil((query.data?.total ?? 0) / parsed.limit),
  );

  return (
    <VStack gap="x6" alignItems="stretch">
      <RouteHeading
        title="결제 이상"
        description="결제·취소의 불확실한 상태를 조회하고 안전하게 대사합니다."
      />

      <AdminCard title="필터">
        <HStack gap="x3" align="flex-end" wrap>
          <FilterSelect
            label="이상 유형"
            value={incidentType}
            options={INCIDENT_TYPES}
            onChange={(event) =>
              replaceQuery({ type: event.currentTarget.value, page: 1 })
            }
          />
          <FilterSelect
            label="상태"
            value={status}
            options={[
              { value: "all", label: "전체" },
              { value: "open", label: "미해결" },
              { value: "resolved", label: "해결" },
            ]}
            onChange={(event) =>
              replaceQuery({ status: event.currentTarget.value, page: 1 })
            }
          />
          <TextField
            type="date"
            label="시작일 (KST)"
            value={parsed.from ?? ""}
            onChange={(event) =>
              replaceQuery({
                from: event.currentTarget.value || undefined,
                page: 1,
              })
            }
          />
          <TextField
            type="date"
            label="종료일 (KST)"
            value={parsed.to ?? ""}
            onChange={(event) =>
              replaceQuery({
                to: event.currentTarget.value || undefined,
                page: 1,
              })
            }
          />
        </HStack>
      </AdminCard>

      <AdminCard
        title="결제 이상 목록"
        description={`총 ${query.data?.total ?? 0}건 · 미해결 목록은 30초마다 갱신`}
        action={
          <ActionButton
            variant="ghost"
            size="small"
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            새로고침
          </ActionButton>
        }
      >
        <VStack gap="x4" alignItems="stretch">
          <AdminTable
            label="결제 이상 목록"
            columns={columns}
            rows={query.data?.items}
            getRowKey={(row) => row.id}
            status={
              query.isLoading ? "loading" : query.isError ? "error" : "success"
            }
            total={query.data?.total}
            sort={{ key: sort, direction: parsed.direction }}
            onSort={({ key, direction }) =>
              replaceQuery({ sort: key, direction, page: 1 })
            }
            onRetry={() => void query.refetch()}
            emptyTitle="조건에 맞는 결제 이상이 없습니다"
          />
          <Pagination
            page={Math.min(parsed.page, totalPages)}
            totalPages={totalPages}
            onPageChange={(page) => replaceQuery({ page })}
            label="결제 이상 목록 페이지"
          />
        </VStack>
      </AdminCard>
    </VStack>
  );
}

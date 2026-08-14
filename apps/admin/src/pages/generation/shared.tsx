import {
  ActionButton,
  Badge,
  Box,
  Grid,
  HStack,
  Skeleton,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import { Link } from "react-router";

import { formatDateTime } from "../../shared/lib/format";
import { DateRangeFilters } from "../../shared/ui/date-range-filters";
import { JOB_STATUS_LABELS } from "./job-status";

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const OPERATIONAL_STATUS_LABELS: Record<string, string> = {
  ...JOB_STATUS_LABELS,
  success: "성공",
  partial: "부분 성공",
  error: "오류",
};

export function isOneOf<T extends string>(
  value: string | undefined,
  values: readonly T[],
): value is T {
  return value !== undefined && values.includes(value as T);
}

export function periodBoundary(date: string | undefined, end: boolean) {
  if (date === undefined) return undefined;
  return `${date}T${end ? "23:59:59.999" : "00:00:00"}+09:00`;
}

export function formatMilliseconds(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return `${Math.round(value).toLocaleString("ko-KR")}ms`;
}

export function formatDuration(start: string, end: string) {
  const elapsed = new Date(end).valueOf() - new Date(start).valueOf();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "-";
  if (elapsed < 1_000) return `${elapsed}ms`;
  if (elapsed < 60_000) return `${(elapsed / 1_000).toFixed(1)}초`;
  return `${(elapsed / 60_000).toFixed(1)}분`;
}

export function operationalStatusLabel(status: string) {
  return OPERATIONAL_STATUS_LABELS[status] ?? status;
}

function compactIdentifier(value: string) {
  return value.length <= 14 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function IdentifierLink({
  value,
  href,
  label,
}: {
  value: string;
  href: string;
  label: string;
}) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      snackbar(`${label}를 복사했습니다.`);
    } catch {
      snackbar(`${label}를 복사하지 못했습니다.`);
    }
  };

  return (
    <HStack gap="x1" wrap>
      <Link to={href} aria-label={`${label} ${value}`} title={value}>
        <Text textStyle="bodySm">{compactIdentifier(value)}</Text>
      </Link>
      <ActionButton
        type="button"
        variant="ghost"
        size="small"
        aria-label={`${label} 복사`}
        onClick={() => void copy()}
      >
        복사
      </ActionButton>
    </HStack>
  );
}

export function OperationalStatusBadge({ status }: { status: string }) {
  const tone = ["succeeded", "success"].includes(status)
    ? "positive"
    : ["failed", "error"].includes(status)
      ? "critical"
      : ["queued", "partial"].includes(status)
        ? "warning"
        : status === "canceled"
          ? "neutral"
          : "informative";
  return <Badge tone={tone}>{operationalStatusLabel(status)}</Badge>;
}

export function RefreshStatus({
  label,
  lastUpdatedAt,
  paused,
  description,
  onToggle,
}: {
  label: string;
  lastUpdatedAt: number;
  paused: boolean;
  description: string;
  onToggle: () => void;
}) {
  return (
    <HStack
      role="group"
      aria-label={`${label} 갱신 상태`}
      justify="space-between"
      align="center"
      gap="x3"
      wrap
    >
      <VStack gap="x1">
        <HStack gap="x2" align="center" wrap>
          <Badge tone={paused ? "warning" : "positive"}>
            {paused ? "자동 갱신 일시정지됨" : "자동 갱신 켜짐"}
          </Badge>
          <Text role="status" aria-live="polite" textStyle="bodySm">
            마지막 성공 갱신:{" "}
            {lastUpdatedAt === 0
              ? "아직 없음"
              : formatDateTime(new Date(lastUpdatedAt))}
          </Text>
        </HStack>
        <Text textStyle="caption" color="fg.neutral-muted">
          {paused
            ? "자동 갱신을 일시정지했습니다. 수동 새로고침은 계속 사용할 수 있습니다."
            : description}
        </Text>
      </VStack>
      <ActionButton variant="neutralOutline" size="small" onClick={onToggle}>
        {paused ? "자동 갱신 재개" : "자동 갱신 일시정지"}
      </ActionButton>
    </HStack>
  );
}

export function MetricGrid({
  items,
  loading,
}: {
  items: readonly { label: string; value: string }[];
  loading: boolean;
}) {
  return (
    <Grid as="dl" columns={{ base: 2, md: 4 }} gap="x3">
      {items.map((item) => (
        <Box
          as="div"
          key={item.label}
          bg="bg.neutral-weak"
          borderRadius="r2"
          p="x3"
        >
          <VStack gap="x1">
            <Text as="dt" textStyle="caption" color="fg.neutral-muted">
              {item.label}
            </Text>
            {loading ? (
              <Skeleton width="70%" height={24} />
            ) : (
              <Text as="dd" textStyle="title3" className="m-0 tabular-nums">
                {item.value}
              </Text>
            )}
          </VStack>
        </Box>
      ))}
    </Grid>
  );
}

export function PeriodFilters({
  from,
  to,
  onFromChange,
  onToChange,
}: {
  from?: string;
  to?: string;
  onFromChange: (value: string | undefined) => void;
  onToChange: (value: string | undefined) => void;
}) {
  return (
    <DateRangeFilters
      from={from}
      to={to}
      onFromChange={onFromChange}
      onToChange={onToChange}
    />
  );
}

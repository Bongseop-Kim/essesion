import { Chip, HStack, Text, TextField, VStack } from "@essesion/shared";

const QUICK_PERIODS = [7, 30, 90] as const;

function kstToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function periodStart(today: string, days: number) {
  const [year, month, day] = today.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCDate(date.getUTCDate() - days + 1);
  return date.toISOString().slice(0, 10);
}

type DateRangeFiltersProps = {
  from?: string;
  to?: string;
  onFromChange: (value: string | undefined) => void;
  onToChange: (value: string | undefined) => void;
};

export function DateRangeFilters({
  from,
  to,
  onFromChange,
  onToChange,
}: DateRangeFiltersProps) {
  const changeFrom = (value: string) => {
    const next = value || undefined;
    if (next !== undefined && to !== undefined && next > to) return;
    onFromChange(next);
  };
  const changeTo = (value: string) => {
    const next = value || undefined;
    if (next !== undefined && from !== undefined && next < from) return;
    onToChange(next);
  };

  const today = kstToday();
  return (
    <VStack gap="x3" alignItems="stretch">
      <Text textStyle="labelSm">기간</Text>
      <HStack gap="x2" wrap>
        <Chip
          size="small"
          selected={from === undefined && to === undefined}
          onClick={() => {
            onFromChange(undefined);
            onToChange(undefined);
          }}
        >
          전체
        </Chip>
        {QUICK_PERIODS.map((days) => {
          const start = periodStart(today, days);
          return (
            <Chip
              key={days}
              size="small"
              selected={from === start && to === today}
              onClick={() => {
                onFromChange(start);
                onToChange(today);
              }}
            >
              최근 {days}일
            </Chip>
          );
        })}
      </HStack>
      <HStack gap="x3" align="flex-end" wrap>
        <TextField
          type="date"
          label="시작일 (KST)"
          value={from ?? ""}
          max={to}
          onChange={(event) => changeFrom(event.currentTarget.value)}
        />
        <TextField
          type="date"
          label="종료일 (KST)"
          value={to ?? ""}
          min={from}
          onChange={(event) => changeTo(event.currentTarget.value)}
        />
      </HStack>
    </VStack>
  );
}

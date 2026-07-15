import { DatePicker } from "@essesion/shared";

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
  return (
    <>
      <DatePicker
        label="시작일 (KST)"
        value={from ?? ""}
        max={to}
        onValueChange={(value) => onFromChange(value || undefined)}
      />
      <DatePicker
        label="종료일 (KST)"
        value={to ?? ""}
        min={from}
        onValueChange={(value) => onToChange(value || undefined)}
      />
    </>
  );
}

import { TextField } from "@essesion/shared";

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
      <TextField
        type="date"
        label="시작일 (KST)"
        value={from ?? ""}
        onChange={(event) =>
          onFromChange(event.currentTarget.value || undefined)
        }
      />
      <TextField
        type="date"
        label="종료일 (KST)"
        value={to ?? ""}
        onChange={(event) => onToChange(event.currentTarget.value || undefined)}
      />
    </>
  );
}

import { TextField, type TextFieldProps } from "@essesion/shared";

/** 기존 호출 표면을 유지하는 네이티브 숫자 입력. */
export type NumberFieldProps = Omit<
  TextFieldProps,
  "type" | "value" | "onChange"
> & {
  value: string;
  onValueChange: (value: string) => void;
  allowNegative?: boolean;
  groupThousands?: boolean;
};

const groupedInteger = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 0,
});

export function formatGroupedInteger(value: string) {
  if (value === "" || value === "-") return value;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? groupedInteger.format(numeric) : value;
}

export function NumberField({
  value,
  onValueChange,
  allowNegative = false,
  groupThousands = false,
  ...props
}: NumberFieldProps) {
  if (groupThousands) {
    return (
      <TextField
        {...props}
        type="text"
        inputMode="numeric"
        value={formatGroupedInteger(value)}
        onChange={(event) => {
          const digits = event.currentTarget.value.replace(/\D/g, "");
          const normalized = digits.replace(/^0+(?=\d)/, "");
          event.currentTarget.value = formatGroupedInteger(normalized);
          onValueChange(normalized);
        }}
      />
    );
  }
  return (
    <TextField
      {...props}
      type="number"
      min={allowNegative ? undefined : 0}
      value={value}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    />
  );
}

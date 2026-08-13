import { TextField, type TextFieldProps } from "@essesion/shared";

/** 기존 호출 표면을 유지하는 네이티브 숫자 입력. */
export type NumberFieldProps = Omit<
  TextFieldProps,
  "type" | "value" | "onChange"
> & {
  value: string;
  onValueChange: (value: string) => void;
  allowNegative?: boolean;
};

export function NumberField({
  value,
  onValueChange,
  allowNegative = false,
  ...props
}: NumberFieldProps) {
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

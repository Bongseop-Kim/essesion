import type { TextFieldProps } from "./text-field";
import { TextField } from "./text-field";

export type DatePickerProps = Omit<TextFieldProps, "type" | "onChange"> & {
  onValueChange?: (value: string) => void;
};

/** 브라우저의 지역화·키보드·날짜 범위 처리를 그대로 쓰는 네이티브 날짜 입력. */
export function DatePicker({ onValueChange, ...props }: DatePickerProps) {
  return (
    <TextField
      {...props}
      type="date"
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
    />
  );
}

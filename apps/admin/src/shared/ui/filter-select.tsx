import { Box, ListPicker, type ListPickerOption } from "@essesion/shared";
import type { ReactNode } from "react";

export type FilterSelectOption = ListPickerOption;

export type FilterSelectProps = {
  label: ReactNode;
  options: readonly FilterSelectOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
};

/* 필터 바 표준 피커 — ListPicker(모바일 시트 ↔ PC 모달)에 필터 폭만 고정 */
export function FilterSelect(props: FilterSelectProps) {
  return (
    <Box minWidth={140}>
      <ListPicker {...props} />
    </Box>
  );
}

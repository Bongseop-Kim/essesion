import {
  Box,
  ListPicker,
  type ListPickerOption,
  RadioGroup,
  RadioGroupItem,
  Text,
  VStack,
} from "@essesion/shared";
import type { ReactNode } from "react";

export type FilterSelectOption = ListPickerOption;

export type FilterSelectProps = {
  label: ReactNode;
  options: readonly FilterSelectOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  /** dialog 안에서는 중첩 overlay를 피하도록 라디오 목록으로 표시한다. */
  presentation?: "picker" | "inline";
};

/* 필터 바 표준 피커 — ListPicker(모바일 시트 ↔ PC 모달)에 필터 폭만 고정 */
export function FilterSelect({
  presentation = "picker",
  ...props
}: FilterSelectProps) {
  if (presentation === "inline") {
    const accessibleLabel =
      typeof props.label === "string" ? props.label : undefined;
    return (
      <VStack gap="x2" alignItems="stretch">
        <Text textStyle="labelSm">{props.label}</Text>
        <RadioGroup
          value={props.value}
          onValueChange={props.onValueChange}
          disabled={props.disabled}
          aria-label={accessibleLabel}
        >
          {props.options.map((option) => (
            <RadioGroupItem
              key={option.value}
              value={option.value}
              label={option.label}
              description={option.description}
              disabled={option.disabled}
            />
          ))}
        </RadioGroup>
      </VStack>
    );
  }

  return (
    <Box minWidth={140}>
      <ListPicker {...props} />
    </Box>
  );
}

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

type FilterSelectCommonProps = {
  options: readonly FilterSelectOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
};

export type FilterSelectProps = FilterSelectCommonProps &
  (
    | {
        label: string;
        presentation: "inline";
      }
    | {
        label: ReactNode;
        presentation?: "picker";
      }
  );

/* 필터 바 표준 피커 — ListPicker(모바일 시트 ↔ PC 모달)에 필터 폭만 고정 */
export function FilterSelect(props: FilterSelectProps) {
  if (props.presentation === "inline") {
    return (
      <VStack gap="x2" alignItems="stretch">
        <Text textStyle="labelSm">{props.label}</Text>
        <RadioGroup
          value={props.value}
          onValueChange={props.onValueChange}
          disabled={props.disabled}
          aria-label={props.label}
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
      <ListPicker
        label={props.label}
        options={props.options}
        value={props.value}
        onValueChange={props.onValueChange}
        disabled={props.disabled}
      />
    </Box>
  );
}

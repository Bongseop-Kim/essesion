import { createContext, type ReactNode, use, useId } from "react";

import type { ResponsiveValue } from "../breakpoint";
import { Flex } from "./flex";
import { Grid } from "./grid";
import { CheckGlyph } from "./internal/glyphs";
import { useControllableState } from "./internal/use-controllable-state";
import { VStack } from "./stack";
import { Text } from "./text";

type SelectBoxContextValue = {
  name: string;
  values: string[];
  toggle: (value: string) => void;
  multiple: boolean;
};

const SelectBoxContext = createContext<SelectBoxContextValue | null>(null);

function useSelectBoxContext() {
  const ctx = use(SelectBoxContext);
  if (!ctx) {
    throw new Error("SelectBoxItem은 <SelectBox> 안에서만 사용할 수 있습니다.");
  }
  return ctx;
}

/** string | string[] → string[]. 빈 문자열은 미선택으로 취급. */
function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  return value === "" ? [] : [value];
}

export type SelectBoxProps = {
  multiple?: boolean;
  /** 라디오/체크박스 name — 미지정 시 useId */
  name?: string;
  value?: string | string[];
  defaultValue?: string | string[];
  onValueChange?: (value: string | string[]) => void;
  /** 1이면 세로 스택, 그 이상(반응형 가능)이면 균등 그리드 */
  columns?: ResponsiveValue<number>;
  children: ReactNode;
  className?: string;
  /** Field 배선용 — useFieldContext의 controlId/describedBy/invalid를 그룹 엘리먼트에 연결 */
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

export function SelectBox({
  multiple = false,
  name,
  value,
  defaultValue,
  onValueChange,
  columns = 1,
  children,
  className,
  id,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedby,
  "aria-invalid": ariaInvalid,
}: SelectBoxProps) {
  const generatedName = useId();
  const [values, setValues] = useControllableState<string[]>({
    value: value === undefined ? undefined : toArray(value),
    defaultValue: toArray(defaultValue),
    onChange: onValueChange
      ? (next) => onValueChange(multiple ? next : (next[0] ?? ""))
      : undefined,
  });
  const toggle = (v: string) => {
    if (multiple) {
      setValues(
        values.includes(v) ? values.filter((x) => x !== v) : [...values, v],
      );
    } else {
      setValues([v]);
    }
  };
  const role = multiple ? "group" : "radiogroup";
  const ctx: SelectBoxContextValue = {
    name: name ?? generatedName,
    values,
    toggle,
    multiple,
  };
  return (
    <SelectBoxContext value={ctx}>
      {columns !== 1 ? (
        <Grid
          columns={columns}
          gap="x3"
          role={role}
          id={id}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedby}
          aria-invalid={ariaInvalid}
          className={className}
        >
          {children}
        </Grid>
      ) : (
        <VStack
          gap="x3"
          alignItems="stretch"
          role={role}
          id={id}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedby}
          aria-invalid={ariaInvalid}
          className={className}
        >
          {children}
        </VStack>
      )}
    </SelectBoxContext>
  );
}

export type SelectBoxItemProps = {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
};

export function SelectBoxItem({
  value,
  label,
  description,
  disabled = false,
}: SelectBoxItemProps) {
  const { name, values, toggle, multiple } = useSelectBoxContext();
  const checked = values.includes(value);
  return (
    <Flex
      as="label"
      position="relative"
      align="flex-start"
      gap="x3"
      px="x4"
      py="x4"
      className="cursor-pointer rounded-r3 border border-stroke-neutral bg-bg-layer-default transition-colors duration-(--duration-fast) ease-standard hover:bg-bg-neutral-weak has-disabled:cursor-not-allowed has-disabled:bg-bg-disabled has-focus-visible:outline has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-stroke-focus-ring"
    >
      <input
        type={multiple ? "checkbox" : "radio"}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => toggle(value)}
        className="peer sr-only"
      />
      {/* 선택 채움 오버레이 — peer(input) 뒤 형제라야 peer-checked가 작동 */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-r3 outline outline-2 -outline-offset-1 outline-stroke-brand opacity-0 transition-opacity duration-(--duration-fast) ease-standard peer-checked:opacity-100"
      />
      <VStack gap="x1" alignItems="stretch" className="min-w-0 flex-1">
        <Text textStyle="label" color={disabled ? "fg.disabled" : "fg.neutral"}>
          {label}
        </Text>
        {description != null && (
          <Text
            textStyle="caption"
            color={disabled ? "fg.disabled" : "fg.neutral-muted"}
          >
            {description}
          </Text>
        )}
      </VStack>
      <CheckGlyph className="size-5 shrink-0 text-transparent transition-colors duration-(--duration-fast) ease-standard peer-checked:text-fg-brand" />
    </Flex>
  );
}

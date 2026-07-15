import { Text, VStack } from "@essesion/shared";
import type { ComponentPropsWithRef, ReactNode } from "react";

export type FilterSelectOption = {
  value: string;
  label: ReactNode;
};

export type FilterSelectProps = Omit<
  ComponentPropsWithRef<"select">,
  "children"
> & {
  label: ReactNode;
  options: readonly FilterSelectOption[];
};

export function FilterSelect({
  label,
  options,
  id,
  ...props
}: FilterSelectProps) {
  return (
    <VStack as="label" gap="x1_5" minWidth={140}>
      <Text as="span" textStyle="labelSm">
        {label}
      </Text>
      <select
        id={id}
        className="h-10 rounded-r2 border border-stroke-neutral-weak bg-bg-layer-default px-x3 text-t4 text-fg-neutral outline-none focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-stroke-brand disabled:bg-bg-disabled disabled:text-fg-disabled"
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </VStack>
  );
}

import { createContext, type ReactNode, use, useId } from "react";

import { cn } from "../cn";
import { Flex } from "./flex";
import { useControllableState } from "./internal/use-controllable-state";

type SegmentedControlContextValue = {
  name: string;
  value: string | undefined;
  setValue: (value: string) => void;
};

const SegmentedControlContext =
  createContext<SegmentedControlContextValue | null>(null);

function useSegmentedControlContext() {
  const ctx = use(SegmentedControlContext);
  if (!ctx) {
    throw new Error(
      "SegmentedControlItem은 <SegmentedControl> 안에서만 사용할 수 있습니다.",
    );
  }
  return ctx;
}

export type SegmentedControlProps = {
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  "aria-label"?: string;
  children: ReactNode;
  className?: string;
};

export function SegmentedControl({
  name,
  value: valueProp,
  defaultValue,
  onValueChange,
  "aria-label": ariaLabel,
  children,
  className,
}: SegmentedControlProps) {
  const generatedName = useId();
  const onChange = onValueChange
    ? (next: string | undefined) => {
        if (next !== undefined) onValueChange(next);
      }
    : undefined;
  const [value, setValue] = useControllableState<string | undefined>({
    value: valueProp,
    defaultValue,
    onChange,
  });
  return (
    <SegmentedControlContext
      value={{ name: name ?? generatedName, value, setValue }}
    >
      <Flex
        role="radiogroup"
        aria-label={ariaLabel}
        display="inline-flex"
        align="center"
        gap="x1"
        p="x1"
        className={cn("rounded-full bg-bg-neutral-weak", className)}
      >
        {children}
      </Flex>
    </SegmentedControlContext>
  );
}

// 네이티브 radio가 화살표 키 이동을 제공하므로 커스텀 키보드 코드는 없다.
const itemLabelClass =
  "flex h-8 items-center justify-center rounded-full px-x4 text-t4 font-bold text-fg-neutral-subtle transition-colors duration-100 ease-standard peer-checked:bg-bg-layer-default peer-checked:text-fg-neutral peer-checked:shadow-s1 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-stroke-focus-ring peer-disabled:text-fg-disabled peer-disabled:cursor-not-allowed cursor-pointer";

export type SegmentedControlItemProps = {
  value: string;
  children: ReactNode;
  disabled?: boolean;
};

export function SegmentedControlItem({
  value,
  children,
  disabled = false,
}: SegmentedControlItemProps) {
  const { name, value: selectedValue, setValue } = useSegmentedControlContext();
  const checked = selectedValue === value;
  return (
    <label>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => setValue(value)}
        className="peer sr-only"
      />
      <span className={itemLabelClass}>{children}</span>
    </label>
  );
}

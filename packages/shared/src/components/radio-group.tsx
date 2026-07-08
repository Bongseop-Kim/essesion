import { createContext, type ReactNode, use, useId } from "react";

import { cn } from "../cn";
import { Flex } from "./flex";
import { useControllableState } from "./internal/use-controllable-state";
import { VStack } from "./stack";
import { Text } from "./text";

type RadioGroupContextValue = {
  name: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
};

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

export type RadioGroupProps = {
  /** 라디오 name — 미지정 시 useId로 자동 부여 */
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  orientation?: "vertical" | "horizontal";
  disabled?: boolean;
  children: ReactNode;
  className?: string;
};

export function RadioGroup({
  name,
  value,
  defaultValue,
  onValueChange,
  orientation = "vertical",
  disabled = false,
  children,
  className,
}: RadioGroupProps) {
  const fallbackName = useId();
  const [current, setCurrent] = useControllableState<string>({
    value,
    defaultValue: defaultValue ?? "",
    onChange: onValueChange,
  });
  return (
    <RadioGroupContext
      value={{
        name: name ?? fallbackName,
        value: current,
        onChange: setCurrent,
        disabled,
      }}
    >
      <Flex
        role="radiogroup"
        direction={orientation === "vertical" ? "column" : "row"}
        gap={orientation === "vertical" ? "x2" : "x4"}
        className={className}
      >
        {children}
      </Flex>
    </RadioGroupContext>
  );
}

const markSizes = {
  medium: "size-5",
  large: "size-6",
};

const dotSizes = {
  medium: "size-2",
  large: "size-2.5",
};

export type RadioGroupItemProps = {
  value: string;
  label?: ReactNode;
  description?: ReactNode;
  size?: keyof typeof markSizes;
  disabled?: boolean;
  className?: string;
};

export function RadioGroupItem({
  value,
  label,
  description,
  size = "medium",
  disabled: itemDisabled = false,
  className,
}: RadioGroupItemProps) {
  const ctx = use(RadioGroupContext);
  if (!ctx) {
    throw new Error("RadioGroupItem은 RadioGroup 안에서만 사용할 수 있습니다.");
  }
  const disabled = ctx.disabled || itemDisabled;
  return (
    <Flex
      as="label"
      display="inline-flex"
      gap="x2"
      align={description ? "flex-start" : "center"}
      className={className}
    >
      <input
        type="radio"
        name={ctx.name}
        value={value}
        checked={ctx.value === value}
        onChange={() => ctx.onChange(value)}
        disabled={disabled}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full border border-stroke-neutral-weak bg-bg-layer-default text-transparent transition-colors duration-100 ease-standard",
          "peer-checked:border-stroke-brand peer-checked:bg-bg-brand-solid peer-checked:text-fg-contrast",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-stroke-focus-ring",
          "peer-disabled:border-stroke-neutral-weak peer-disabled:bg-bg-disabled",
          markSizes[size],
        )}
      >
        <span className={cn("rounded-full bg-current", dotSizes[size])} />
      </span>
      {(label != null || description != null) && (
        <VStack as="span" gap="x0_5" minWidth={0}>
          {label != null && (
            <Text
              as="span"
              textStyle={size === "large" ? "label" : "labelSm"}
              color={disabled ? "fg.disabled" : "fg.neutral"}
              className="select-none"
            >
              {label}
            </Text>
          )}
          {description != null && (
            <Text
              as="span"
              textStyle="caption"
              color={disabled ? "fg.disabled" : "fg.neutral-subtle"}
            >
              {description}
            </Text>
          )}
        </VStack>
      )}
    </Flex>
  );
}

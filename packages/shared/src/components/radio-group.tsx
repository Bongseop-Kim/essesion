import { createContext, type ReactNode, use, useId } from "react";

import { cn } from "../cn";
import { useControllableState } from "./internal/use-controllable-state";

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
      <div
        role="radiogroup"
        className={cn(
          "flex",
          orientation === "vertical" ? "flex-col gap-x2" : "flex-row gap-x4",
          className,
        )}
      >
        {children}
      </div>
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

const labelSizes = {
  medium: "text-t4",
  large: "text-t5",
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
    <label
      className={cn(
        "inline-flex gap-x2",
        description ? "items-start" : "items-center",
        className,
      )}
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
        <span className="flex min-w-0 flex-col gap-x0_5">
          {label != null && (
            <span
              className={cn(
                "font-medium select-none",
                labelSizes[size],
                disabled ? "text-fg-disabled" : "text-fg-neutral",
              )}
            >
              {label}
            </span>
          )}
          {description != null && (
            <span
              className={cn(
                "text-t3",
                disabled ? "text-fg-disabled" : "text-fg-neutral-subtle",
              )}
            >
              {description}
            </span>
          )}
        </span>
      )}
    </label>
  );
}

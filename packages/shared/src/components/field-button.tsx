import type { ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "../cn";
import { Field, useFieldContext } from "./field";
import { Flex } from "./flex";
import { ChevronDownGlyph } from "./internal/glyphs";
import { Text } from "./text";

type FrameSize = "medium" | "large";

/* TextField의 frame과 동일 치수·테두리 규칙. 포커스는 outline 기법(레이아웃 시프트 방지),
   입력 계열이므로 focus-visible 링은 파란 링이 아니라 stroke.brand. */
const frameBase =
  "flex w-full items-center gap-x2 border border-stroke-neutral-weak bg-bg-layer-default text-left transition-colors duration-100 ease-standard focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-stroke-focus-ring";

const sizes: Record<FrameSize, string> = {
  medium: "h-10 rounded-r2 px-x3_5 text-t4",
  large: "h-13 rounded-r3 px-x4 text-t5",
};

export type FieldButtonProps = Omit<
  ComponentPropsWithRef<"button">,
  "value"
> & {
  size?: FrameSize;
  label?: ReactNode;
  description?: ReactNode;
  errorMessage?: ReactNode;
  /** value가 없을 때 표시할 값 (fg.placeholder) */
  placeholder?: ReactNode;
  /** 선택된 값 — 존재 시 fg.neutral로 표시 */
  value?: ReactNode;
  /** 우측 슬롯 — 기본 ChevronDownGlyph */
  suffix?: ReactNode;
};

function FieldButtonControl({
  size,
  placeholder,
  value,
  suffix,
  buttonProps,
}: {
  size: FrameSize;
  placeholder?: ReactNode;
  value?: ReactNode;
  suffix?: ReactNode;
  buttonProps: Omit<ComponentPropsWithRef<"button">, "value">;
}) {
  const field = useFieldContext();
  const invalid = field?.invalid ?? false;
  const disabled = field?.disabled ?? buttonProps.disabled ?? false;
  const hasValue = value != null;
  const resolvedSuffix = suffix ?? (
    <ChevronDownGlyph className="size-4 text-fg-neutral-muted" />
  );
  return (
    <button
      type="button"
      {...buttonProps}
      id={field?.controlId ?? buttonProps.id}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-describedby={field?.describedBy ?? buttonProps["aria-describedby"]}
      className={cn(
        frameBase,
        sizes[size],
        // errorMessage 존재 시 상시 표시 (state.md 폼 필드 규칙)
        invalid &&
          "outline outline-2 -outline-offset-1 outline-stroke-critical",
        // 폼 필드 disabled는 opacity 금지 — bg/fg 토큰으로 (state.md)
        disabled && "bg-bg-disabled text-fg-disabled",
        buttonProps.className,
      )}
    >
      <Text
        as="span"
        textStyle={size === "large" ? "body" : "bodySm"}
        color={
          disabled ? "fg.disabled" : hasValue ? "fg.neutral" : "fg.placeholder"
        }
        className={cn("min-w-0 flex-1 truncate")}
      >
        {hasValue ? value : placeholder}
      </Text>
      {resolvedSuffix != null && (
        <Flex as="span" shrink={0} align="center">
          {resolvedSuffix}
        </Flex>
      )}
    </button>
  );
}

export function FieldButton({
  size = "medium",
  label,
  description,
  errorMessage,
  placeholder,
  value,
  suffix,
  ...buttonProps
}: FieldButtonProps) {
  const control = (
    <FieldButtonControl
      size={size}
      placeholder={placeholder}
      value={value}
      suffix={suffix}
      buttonProps={buttonProps}
    />
  );
  if (label == null && description == null && errorMessage == null) {
    return control;
  }
  return (
    <Field
      label={label}
      description={description}
      errorMessage={errorMessage}
      disabled={buttonProps.disabled}
    >
      {control}
    </Field>
  );
}

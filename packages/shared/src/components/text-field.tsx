import type { ComponentPropsWithRef, CSSProperties, ReactNode } from "react";

import { cn } from "../cn";
import { Field, useFieldContext } from "./field";
import { Flex } from "./flex";

type FrameSize = "medium" | "large";

type FieldOwnProps = {
  size?: FrameSize;
  label?: ReactNode;
  description?: ReactNode;
  errorMessage?: ReactNode;
  prefix?: ReactNode;
  suffix?: ReactNode;
};

/* 컨테이너/컨트롤 스타일은 ActionButton과 같은 size 레코드 + cn() 패턴.
   포커스는 outline 기법으로 처리(테두리 두께 변화로 인한 레이아웃 시프트 방지). */
const frameBase =
  "border border-stroke-neutral-weak bg-bg-layer-default transition-colors duration-100 ease-standard focus-within:outline focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-stroke-brand";

const inputSizes: Record<FrameSize, string> = {
  medium: "h-10 rounded-r2 px-x3_5 text-t4",
  large: "h-13 rounded-r3 px-x4 text-t5",
};

const textAreaSizes: Record<FrameSize, string> = {
  medium: "min-h-10 rounded-r2 px-x3_5 py-x3 text-t4",
  large: "min-h-13 rounded-r3 px-x4 py-x3_5 text-t5",
};

const controlClass =
  "w-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-placeholder disabled:text-fg-disabled";

function FieldFrame({
  multiline,
  size,
  invalid,
  disabled,
  prefix,
  suffix,
  children,
}: {
  multiline: boolean;
  size: FrameSize;
  invalid: boolean;
  disabled: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Flex
      gap="x2"
      align={multiline ? "flex-start" : "center"}
      className={cn(
        frameBase,
        (multiline ? textAreaSizes : inputSizes)[size],
        // errorMessage 존재 시 상시 표시 (state.md 폼 필드 규칙)
        invalid &&
          "outline outline-2 -outline-offset-1 outline-stroke-critical",
        // 폼 필드 disabled는 opacity 금지 — bg/fg 토큰으로 (state.md)
        disabled && "bg-bg-disabled text-fg-disabled",
      )}
    >
      {prefix != null && (
        <span className="shrink-0 text-fg-neutral-muted">{prefix}</span>
      )}
      {children}
      {suffix != null && (
        <span className="shrink-0 text-fg-neutral-muted">{suffix}</span>
      )}
    </Flex>
  );
}

export type TextFieldProps = Omit<ComponentPropsWithRef<"input">, "size"> &
  FieldOwnProps;

function TextFieldControl({
  size,
  prefix,
  suffix,
  inputProps,
}: {
  size: FrameSize;
  prefix?: ReactNode;
  suffix?: ReactNode;
  inputProps: Omit<ComponentPropsWithRef<"input">, "size">;
}) {
  const field = useFieldContext();
  const invalid = field?.invalid ?? false;
  const disabled = field?.disabled ?? inputProps.disabled ?? false;
  return (
    <FieldFrame
      multiline={false}
      size={size}
      invalid={invalid}
      disabled={disabled}
      prefix={prefix}
      suffix={suffix}
    >
      <input
        {...inputProps}
        id={field?.controlId ?? inputProps.id}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={field?.describedBy ?? inputProps["aria-describedby"]}
        className={cn(controlClass, inputProps.className)}
      />
    </FieldFrame>
  );
}

export function TextField({
  size = "medium",
  label,
  description,
  errorMessage,
  prefix,
  suffix,
  ...inputProps
}: TextFieldProps) {
  const control = (
    <TextFieldControl
      size={size}
      prefix={prefix}
      suffix={suffix}
      inputProps={inputProps}
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
      required={inputProps.required}
      disabled={inputProps.disabled}
    >
      {control}
    </Field>
  );
}

export type TextAreaFieldProps = Omit<
  ComponentPropsWithRef<"textarea">,
  "size"
> &
  FieldOwnProps & {
    rows?: number;
    /** true면 내용에 맞춰 높이 자동 조절 (fieldSizing: content — Chromium 전용, 폴백은 rows). */
    autoResize?: boolean;
  };

function TextAreaFieldControl({
  size,
  rows,
  autoResize,
  prefix,
  suffix,
  textAreaProps,
}: {
  size: FrameSize;
  rows: number;
  autoResize: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
  textAreaProps: Omit<ComponentPropsWithRef<"textarea">, "size">;
}) {
  const field = useFieldContext();
  const invalid = field?.invalid ?? false;
  const disabled = field?.disabled ?? textAreaProps.disabled ?? false;
  // fieldSizing은 CSSProperties 타입에 없어 캐스팅 필요.
  const style = autoResize
    ? ({ fieldSizing: "content", ...textAreaProps.style } as CSSProperties)
    : textAreaProps.style;
  return (
    <FieldFrame
      multiline
      size={size}
      invalid={invalid}
      disabled={disabled}
      prefix={prefix}
      suffix={suffix}
    >
      <textarea
        {...textAreaProps}
        rows={rows}
        id={field?.controlId ?? textAreaProps.id}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={
          field?.describedBy ?? textAreaProps["aria-describedby"]
        }
        style={style}
        className={cn(controlClass, textAreaProps.className)}
      />
    </FieldFrame>
  );
}

export function TextAreaField({
  size = "medium",
  label,
  description,
  errorMessage,
  prefix,
  suffix,
  rows = 3,
  autoResize = false,
  ...textAreaProps
}: TextAreaFieldProps) {
  const control = (
    <TextAreaFieldControl
      size={size}
      rows={rows}
      autoResize={autoResize}
      prefix={prefix}
      suffix={suffix}
      textAreaProps={textAreaProps}
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
      required={textAreaProps.required}
      disabled={textAreaProps.disabled}
    >
      {control}
    </Field>
  );
}

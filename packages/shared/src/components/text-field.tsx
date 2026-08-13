import type { ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "../cn";
import { Field, useFieldContext } from "./field";
import { Flex } from "./flex";

type FieldOwnProps = {
  label?: ReactNode;
  description?: ReactNode;
  errorMessage?: ReactNode;
  prefix?: ReactNode;
  suffix?: ReactNode;
};

/* 컨테이너/컨트롤 스타일은 ActionButton과 같은 size 레코드 + cn() 패턴.
   포커스는 outline 기법으로 처리(테두리 두께 변화로 인한 레이아웃 시프트 방지). */
const frameBase =
  "border border-stroke-neutral-weak bg-bg-layer-default transition-colors duration-(--duration-fast) ease-standard focus-within:outline focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-stroke-brand";

const inputSize = "h-10 rounded-r2 px-x3_5 text-t4";
const textAreaSize = "min-h-10 rounded-r2 px-x3_5 py-x3 text-t4";

const controlClass =
  "w-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-placeholder disabled:text-fg-disabled";

function FieldFrame({
  multiline,
  invalid,
  disabled,
  prefix,
  suffix,
  children,
}: {
  multiline: boolean;
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
        multiline ? textAreaSize : inputSize,
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

// native `prefix`(RDFa 문자열 속성)를 빼야 ReactNode 슬롯이 앱에서 쓸 수 있다 — Chip과 같은 처리.
export type TextFieldProps = Omit<
  ComponentPropsWithRef<"input">,
  "size" | "prefix"
> &
  FieldOwnProps;

function TextFieldControl({
  prefix,
  suffix,
  inputProps,
}: {
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
  label,
  description,
  errorMessage,
  prefix,
  suffix,
  ...inputProps
}: TextFieldProps) {
  const control = (
    <TextFieldControl prefix={prefix} suffix={suffix} inputProps={inputProps} />
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
  "size" | "prefix"
> &
  FieldOwnProps & {
    rows?: number;
  };

function TextAreaFieldControl({
  rows,
  prefix,
  suffix,
  textAreaProps,
}: {
  rows: number;
  prefix?: ReactNode;
  suffix?: ReactNode;
  textAreaProps: Omit<ComponentPropsWithRef<"textarea">, "size">;
}) {
  const field = useFieldContext();
  const invalid = field?.invalid ?? false;
  const disabled = field?.disabled ?? textAreaProps.disabled ?? false;
  return (
    <FieldFrame
      multiline
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
        className={cn(controlClass, textAreaProps.className)}
      />
    </FieldFrame>
  );
}

export function TextAreaField({
  label,
  description,
  errorMessage,
  prefix,
  suffix,
  rows = 3,
  ...textAreaProps
}: TextAreaFieldProps) {
  const control = (
    <TextAreaFieldControl
      rows={rows}
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

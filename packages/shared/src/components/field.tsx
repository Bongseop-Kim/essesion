import { createContext, type ReactNode, use, useId } from "react";
import { VStack } from "./stack";
import { Text } from "./text";

export type FieldContextValue = {
  controlId: string;
  describedBy: string | undefined;
  invalid: boolean;
  disabled: boolean;
  required: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

/** Field 내부 컨트롤(TextField 등)이 id/aria 배선을 가져갈 때 사용. Field 밖이면 null. */
export function useFieldContext() {
  return use(FieldContext);
}

export type FieldProps = {
  label?: ReactNode;
  description?: ReactNode;
  errorMessage?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  children: ReactNode;
};

/** 폼 필드 래퍼 — label/description/error 배치와 aria-describedby 배선.
    TextField·TextAreaField·FieldButton·AttachmentDisplayField가 내부에서 사용,
    앱의 커스텀 컨트롤 래핑용으로도 공개. */
export function Field({
  label,
  description,
  errorMessage,
  required = false,
  disabled = false,
  children,
}: FieldProps) {
  const id = useId();
  const controlId = `${id}-control`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const invalid = errorMessage != null;

  const describedBy =
    [description != null && descriptionId, invalid && errorId]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <FieldContext
      value={{ controlId, describedBy, invalid, disabled, required }}
    >
      <VStack gap="x1_5" alignItems="stretch">
        {label != null && (
          <Text
            as="label"
            htmlFor={controlId}
            textStyle="labelSm"
            color={disabled ? "fg.disabled" : "fg.neutral"}
          >
            {label}
            {required && (
              <Text as="span" color="fg.critical" aria-hidden>
                {" *"}
              </Text>
            )}
          </Text>
        )}
        {children}
        {description != null && (
          <Text
            id={descriptionId}
            textStyle="caption"
            color="fg.neutral-subtle"
          >
            {description}
          </Text>
        )}
        {invalid && (
          <Text
            id={errorId}
            textStyle="caption"
            color="fg.critical"
            aria-live="polite"
          >
            {errorMessage}
          </Text>
        )}
      </VStack>
    </FieldContext>
  );
}

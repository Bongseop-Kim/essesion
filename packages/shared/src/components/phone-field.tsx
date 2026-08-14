import { TextField, type TextFieldProps } from "./text-field";

const PHONE_PATTERN = /^01\d{8,9}$/;

export function normalizePhoneNumber(value: string) {
  return value.replace(/\D/g, "");
}

/** 유효한 국내 휴대폰 번호만 숫자 원문으로 바꾸고, 알 수 없는 기존 값은 보존한다. */
export function canonicalizePhoneNumber(value: string) {
  const trimmed = value.trim();
  if (!/^[\d\s()-]+$/.test(trimmed)) return trimmed;
  const normalized = normalizePhoneNumber(trimmed);
  return PHONE_PATTERN.test(normalized) ? normalized : trimmed;
}

function formatPartialPhoneNumber(value: string) {
  if (value.length <= 3) return value;
  if (value.length <= 7) return `${value.slice(0, 3)}-${value.slice(3)}`;
  if (value.length === 10) {
    return `${value.slice(0, 3)}-${value.slice(3, 6)}-${value.slice(6)}`;
  }
  return `${value.slice(0, 3)}-${value.slice(3, 7)}-${value.slice(7)}`;
}

/** 저장 형식과 무관하게 유효한 국내 휴대폰 번호를 읽기 좋은 형태로 표시한다. */
export function formatPhoneNumber(value: string) {
  const normalized = canonicalizePhoneNumber(value);
  return PHONE_PATTERN.test(normalized)
    ? formatPartialPhoneNumber(normalized)
    : value;
}

/** 숫자·공백·괄호·하이픈으로 된 기존 값은 입력 중에도 같은 형식으로 표시한다. */
export function formatPhoneInput(value: string) {
  const normalized = normalizePhoneNumber(value);
  if (!/^[\d\s()-]*$/.test(value) || normalized.length > 11) return value;
  return formatPartialPhoneNumber(normalized);
}

export type PhoneFieldProps = Omit<
  TextFieldProps,
  | "type"
  | "inputMode"
  | "autoComplete"
  | "maxLength"
  | "value"
  | "defaultValue"
  | "onChange"
> & {
  value: string;
  onValueChange: (value: string) => void;
};

export function PhoneField({
  value,
  onValueChange,
  placeholder = "010-0000-0000",
  ...props
}: PhoneFieldProps) {
  return (
    <TextField
      {...props}
      type="tel"
      inputMode="numeric"
      autoComplete="tel"
      maxLength={13}
      placeholder={placeholder}
      value={formatPhoneInput(value)}
      onChange={(event) => {
        const normalized = normalizePhoneNumber(
          event.currentTarget.value,
        ).slice(0, 11);
        event.currentTarget.value = formatPartialPhoneNumber(normalized);
        onValueChange(normalized);
      }}
    />
  );
}

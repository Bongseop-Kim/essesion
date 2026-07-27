import { TextField, type TextFieldProps } from "@essesion/shared";
import { useLayoutEffect, useRef } from "react";

/** 천 단위 콤마를 표시하는 정수 입력. 금액·수량 필드는 `type="number"` 대신 이걸 쓴다.
 *  값은 콤마 없는 원본 문자열로 오간다(""는 미입력). min/max/step은 텍스트 입력에서
 *  동작하지 않으므로 받지 않는다 — 범위 검증은 각 화면의 JS 검증이 담당한다. */
export type NumberFieldProps = Omit<
  TextFieldProps,
  "type" | "inputMode" | "value" | "onChange" | "ref" | "min" | "max" | "step"
> & {
  value: string;
  onValueChange: (value: string) => void;
  /** 선행 `-`로 음수 입력 허용. */
  allowNegative?: boolean;
};

function toRaw(text: string, allowNegative: boolean) {
  const sign = allowNegative && text.trimStart().startsWith("-") ? "-" : "";
  return sign + text.replace(/\D/g, "");
}

// Number를 거치지 않는다 — 자릿수가 커도 정밀도 손실이 없도록.
function toDisplay(raw: string) {
  const sign = raw.startsWith("-") ? "-" : "";
  const digits = raw.replace(/\D/g, "");
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function NumberField({
  value,
  onValueChange,
  allowNegative = false,
  ...props
}: NumberFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // 콤마가 끼어들어도 캐럿이 끝으로 튀지 않도록 "캐럿 앞 콤마 아닌 글자 수"로 위치를 복원한다.
  // ponytail: 콤마 자체를 지우면 아무 일도 일어나지 않는다(숫자 삭제로 승격하지 않음).
  const caretChars = useRef<number | null>(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const target = caretChars.current;
    caretChars.current = null;
    if (input === null || target === null) return;
    let seen = 0;
    let caret = 0;
    for (const char of input.value) {
      if (seen >= target) break;
      if (char !== ",") seen += 1;
      caret += 1;
    }
    input.setSelectionRange(caret, caret);
  });

  return (
    <TextField
      {...props}
      ref={inputRef}
      inputMode="numeric"
      value={toDisplay(value)}
      onChange={(event) => {
        const input = event.currentTarget;
        const head = input.value.slice(0, input.selectionStart ?? 0);
        caretChars.current =
          head.replace(/\D/g, "").length +
          (allowNegative && head.startsWith("-") ? 1 : 0);
        onValueChange(toRaw(input.value, allowNegative));
      }}
    />
  );
}

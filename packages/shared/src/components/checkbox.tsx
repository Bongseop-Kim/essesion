import {
  type ComponentPropsWithRef,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from "react";

import { cn } from "../cn";
import { CheckGlyph, DashGlyph } from "./internal/glyphs";

const boxSizes = {
  medium: "size-5",
  large: "size-6",
};

const glyphSizes = {
  medium: "size-3.5",
  large: "size-4",
};

const labelSizes = {
  medium: "text-t4",
  large: "text-t5",
};

export type CheckboxProps = Omit<
  ComponentPropsWithRef<"input">,
  "size" | "type"
> & {
  size?: keyof typeof boxSizes;
  /** 부분 선택 상태 — DOM indeterminate + aria-checked="mixed" */
  indeterminate?: boolean;
  label?: ReactNode;
  description?: ReactNode;
};

export function Checkbox({
  size = "medium",
  indeterminate = false,
  label,
  description,
  className,
  disabled,
  ref,
  ...props
}: CheckboxProps) {
  // indeterminate는 속성이 아니라 DOM 프로퍼티 — 노드에 직접 세팅하고 유저 ref는 병합.
  const innerRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (innerRef.current) innerRef.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const setRef = useCallback(
    (node: HTMLInputElement | null) => {
      innerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const Glyph = indeterminate ? DashGlyph : CheckGlyph;

  return (
    <label
      className={cn(
        "inline-flex gap-x2",
        description ? "items-start" : "items-center",
        className,
      )}
    >
      <input
        type="checkbox"
        ref={setRef}
        disabled={disabled}
        aria-checked={indeterminate ? "mixed" : undefined}
        className="peer sr-only"
        {...props}
      />
      <span
        aria-hidden
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-r1 border border-stroke-neutral-weak bg-bg-layer-default text-transparent transition-colors duration-100 ease-standard",
          "peer-checked:border-stroke-brand peer-checked:bg-bg-brand-solid peer-checked:text-fg-contrast",
          "peer-indeterminate:border-stroke-brand peer-indeterminate:bg-bg-brand-solid peer-indeterminate:text-fg-contrast",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-stroke-focus-ring",
          "peer-disabled:border-stroke-neutral-weak peer-disabled:bg-bg-disabled",
          boxSizes[size],
        )}
      >
        <Glyph className={glyphSizes[size]} />
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

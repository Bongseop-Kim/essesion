import {
  type ComponentPropsWithRef,
  createContext,
  type ReactNode,
  use,
  useId,
} from "react";

import { cn } from "../cn";
import { focusRingInset } from "./internal/focus-ring";
import { ChevronDownGlyph } from "./internal/glyphs";
import { useControllableState } from "./internal/use-controllable-state";

type AccordionVariant = "inline" | "separated";

type AccordionContextValue = {
  openValues: string[];
  toggle: (value: string) => void;
  variant: AccordionVariant;
  idPrefix: string;
};

const AccordionContext = createContext<AccordionContextValue | null>(null);

function useAccordionContext() {
  const ctx = use(AccordionContext);
  if (!ctx) {
    throw new Error(
      "Accordion 하위 컴포넌트는 <Accordion> 안에서만 사용할 수 있습니다.",
    );
  }
  return ctx;
}

const AccordionItemContext = createContext<string | null>(null);

function useAccordionItemValue() {
  const value = use(AccordionItemContext);
  if (value === null) {
    throw new Error(
      "AccordionTrigger·AccordionContent는 <AccordionItem> 안에서만 사용할 수 있습니다.",
    );
  }
  return value;
}

function toArray(value: string[] | string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

export type AccordionProps = {
  type?: "single" | "multiple";
  /** single일 때 열린 항목을 다시 눌러 전부 닫기 허용 (기본 true) */
  collapsible?: boolean;
  value?: string[] | string;
  defaultValue?: string[] | string;
  onValueChange?: (value: string[]) => void;
  variant?: AccordionVariant;
  children: ReactNode;
  className?: string;
};

/** 접이식 목록 — 내부 상태는 열린 value의 string[]로 정규화. */
export function Accordion({
  type = "single",
  collapsible = true,
  value,
  defaultValue,
  onValueChange,
  variant = "inline",
  children,
  className,
}: AccordionProps) {
  const idPrefix = useId();
  const [openValues, setOpenValues] = useControllableState<string[]>({
    value: toArray(value),
    defaultValue: toArray(defaultValue) ?? [],
    onChange: onValueChange,
  });

  function toggle(itemValue: string) {
    const isOpen = openValues.includes(itemValue);
    if (type === "single") {
      if (isOpen) {
        setOpenValues(collapsible ? [] : openValues);
      } else {
        setOpenValues([itemValue]);
      }
      return;
    }
    setOpenValues(
      isOpen
        ? openValues.filter((v) => v !== itemValue)
        : [...openValues, itemValue],
    );
  }

  return (
    <AccordionContext value={{ openValues, toggle, variant, idPrefix }}>
      <div
        className={cn(
          variant === "separated" && "flex flex-col gap-x3",
          className,
        )}
      >
        {children}
      </div>
    </AccordionContext>
  );
}

export type AccordionItemProps = {
  value: string;
  children: ReactNode;
};

/** 접이식 항목 — 자기 value를 하위에 제공. */
export function AccordionItem({ value, children }: AccordionItemProps) {
  const { variant } = useAccordionContext();
  return (
    <AccordionItemContext value={value}>
      <div
        className={
          variant === "inline"
            ? "border-b border-stroke-neutral-weak"
            : "rounded-r3 border border-stroke-neutral-weak"
        }
      >
        {children}
      </div>
    </AccordionItemContext>
  );
}

export type AccordionTriggerProps = ComponentPropsWithRef<"button">;

/** 접이식 항목 헤더 버튼 — h3로 감싸고 셰브론 회전. */
export function AccordionTrigger({
  children,
  className,
  onClick,
  ...props
}: AccordionTriggerProps) {
  const { openValues, toggle, idPrefix } = useAccordionContext();
  const value = useAccordionItemValue();
  const open = openValues.includes(value);
  return (
    <h3 className="m-0">
      <button
        type="button"
        id={`${idPrefix}-${value}-trigger`}
        aria-expanded={open}
        aria-controls={`${idPrefix}-${value}-content`}
        onClick={(event) => {
          onClick?.(event);
          toggle(value);
        }}
        className={cn(
          "flex w-full items-center justify-between gap-x2 px-x4 py-x4 text-left text-t5 font-medium transition-colors duration-(--duration-fast) ease-standard hover:bg-bg-neutral-weak",
          focusRingInset,
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDownGlyph
          className={cn(
            "size-4 shrink-0 text-fg-neutral-muted transition-transform duration-(--duration-normal) ease-standard",
            open && "rotate-180",
          )}
        />
      </button>
    </h3>
  );
}

export type AccordionContentProps = ComponentPropsWithRef<"section">;

/** 접이식 본문 — grid-template-rows 0fr↔1fr 높이 애니메이션. 닫혀도 DOM 유지. */
export function AccordionContent({
  children,
  className,
  style,
  ...props
}: AccordionContentProps) {
  const { openValues, idPrefix } = useAccordionContext();
  const value = useAccordionItemValue();
  const open = openValues.includes(value);
  return (
    <div
      className="grid"
      style={{
        gridTemplateRows: open ? "1fr" : "0fr",
        transition:
          "grid-template-rows var(--duration-normal) var(--ease-standard)",
      }}
    >
      <div className="min-h-0 overflow-hidden">
        {/* aria-labelledby가 있는 section은 암묵적 region 랜드마크 */}
        <section
          id={`${idPrefix}-${value}-content`}
          aria-labelledby={`${idPrefix}-${value}-trigger`}
          aria-hidden={open ? undefined : true}
          inert={open ? undefined : true}
          className={cn("px-x4 pb-x4 text-t4 text-fg-neutral-muted", className)}
          style={style}
          {...props}
        >
          {children}
        </section>
      </div>
    </div>
  );
}

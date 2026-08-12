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
  openValues: readonly string[];
  setItemOpen: (value: string, open: boolean) => void;
  variant: AccordionVariant;
  idPrefix: string;
};

const AccordionContext = createContext<AccordionContextValue | null>(null);

function useAccordionContext() {
  const context = use(AccordionContext);
  if (context === null) {
    throw new Error(
      "Accordion 하위 컴포넌트는 <Accordion> 안에서만 사용할 수 있습니다.",
    );
  }
  return context;
}

type AccordionItemContextValue = {
  value: string;
  open: boolean;
};

const AccordionItemContext = createContext<AccordionItemContextValue | null>(
  null,
);

function useAccordionItemContext() {
  const context = use(AccordionItemContext);
  if (context === null) {
    throw new Error(
      "AccordionTrigger·AccordionContent는 <AccordionItem> 안에서만 사용할 수 있습니다.",
    );
  }
  return context;
}

function values(value: string[] | string | undefined) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export type AccordionProps = {
  type?: "single" | "multiple";
  value?: string[] | string;
  defaultValue?: string[] | string;
  onValueChange?: (value: string[]) => void;
  variant?: AccordionVariant;
  children: ReactNode;
  className?: string;
};

/** 네이티브 details/summary 기반 접이식 목록. */
export function Accordion({
  type = "single",
  value,
  defaultValue,
  onValueChange,
  variant = "inline",
  children,
  className,
}: AccordionProps) {
  const idPrefix = useId();
  const [openValues, setOpenValues] = useControllableState({
    value: value === undefined ? undefined : values(value),
    defaultValue: values(defaultValue),
    onChange: onValueChange,
  });
  const setItemOpen = (itemValue: string, open: boolean) => {
    if (open === openValues.includes(itemValue)) return;
    if (open) {
      setOpenValues(
        type === "single" ? [itemValue] : [...openValues, itemValue],
      );
      return;
    }
    setOpenValues(openValues.filter((item) => item !== itemValue));
  };
  return (
    <AccordionContext
      value={{
        openValues,
        setItemOpen,
        variant,
        idPrefix,
      }}
    >
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

export function AccordionItem({ value, children }: AccordionItemProps) {
  const { openValues, setItemOpen, variant } = useAccordionContext();
  const open = openValues.includes(value);
  return (
    <AccordionItemContext value={{ value, open }}>
      <details
        open={open}
        onToggle={(event) => setItemOpen(value, event.currentTarget.open)}
        className={cn(
          "group",
          variant === "inline"
            ? "border-b border-stroke-neutral-weak"
            : "rounded-r3 border border-stroke-neutral-weak",
        )}
      >
        {children}
      </details>
    </AccordionItemContext>
  );
}

export type AccordionTriggerProps = Omit<
  ComponentPropsWithRef<"summary">,
  "aria-disabled"
> & {
  disabled?: boolean;
};

export function AccordionTrigger({
  children,
  className,
  disabled = false,
  onClick,
  ...props
}: AccordionTriggerProps) {
  const { idPrefix } = useAccordionContext();
  const { value, open } = useAccordionItemContext();
  return (
    // Expose summary's implicit button role consistently to DOM accessibility tools.
    // biome-ignore lint/a11y/useSemanticElements: summary provides native disclosure behavior
    <summary
      id={`${idPrefix}-${value}-trigger`}
      role="button"
      aria-controls={`${idPrefix}-${value}-content`}
      aria-expanded={open}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (disabled) event.preventDefault();
      }}
      className={cn(
        "flex w-full cursor-pointer list-none items-center justify-between gap-x2 px-x4 py-x4 text-left text-t5 font-medium marker:hidden hover:bg-bg-neutral-weak aria-disabled:cursor-default aria-disabled:text-fg-disabled",
        focusRingInset,
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDownGlyph className="size-4 shrink-0 text-fg-neutral-muted group-open:rotate-180" />
    </summary>
  );
}

export type AccordionContentProps = ComponentPropsWithRef<"section">;

export function AccordionContent({
  children,
  className,
  ...props
}: AccordionContentProps) {
  const { idPrefix } = useAccordionContext();
  const { value, open } = useAccordionItemContext();
  return (
    <section
      id={`${idPrefix}-${value}-content`}
      aria-labelledby={`${idPrefix}-${value}-trigger`}
      aria-hidden={open ? undefined : true}
      inert={open ? undefined : true}
      className={cn("px-x4 pb-x4 text-t4 text-fg-neutral-muted", className)}
      {...props}
    >
      {children}
    </section>
  );
}

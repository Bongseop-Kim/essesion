import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  use,
  useId,
} from "react";

import { cn } from "../cn";
import { useControllableState } from "./internal/use-controllable-state";

type TabsContextValue = {
  value: string | undefined;
  setValue: (value: string) => void;
  idPrefix: string;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const ctx = use(TabsContext);
  if (!ctx) {
    throw new Error("Tabs 하위 컴포넌트는 <Tabs> 안에서만 사용할 수 있습니다.");
  }
  return ctx;
}

type TriggerLayout = "hug" | "fill";

const TabListContext = createContext<TriggerLayout>("hug");

export type TabsProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
};

export function Tabs({
  value: valueProp,
  defaultValue,
  onValueChange,
  children,
  className,
}: TabsProps) {
  const idPrefix = useId();
  // setValue는 항상 실제 문자열로만 호출되므로 undefined는 흘려보낸다.
  const onChange = onValueChange
    ? (next: string | undefined) => {
        if (next !== undefined) onValueChange(next);
      }
    : undefined;
  const [value, setValue] = useControllableState<string | undefined>({
    value: valueProp,
    defaultValue,
    onChange,
  });
  return (
    <TabsContext value={{ value, setValue, idPrefix }}>
      <div className={className}>{children}</div>
    </TabsContext>
  );
}

export type TabListProps = {
  triggerLayout?: TriggerLayout;
  children: ReactNode;
  "aria-label"?: string;
};

export function TabList({
  triggerLayout = "hug",
  children,
  "aria-label": ariaLabel,
}: TabListProps) {
  // roving tabindex — 화살표/Home/End로 포커스를 옮기고 즉시 선택한다.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]:not([disabled])',
      ),
    );
    if (tabs.length === 0) return;
    const activeIndex = tabs.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    let nextIndex: number;
    switch (event.key) {
      case "ArrowLeft":
        nextIndex = activeIndex <= 0 ? tabs.length - 1 : activeIndex - 1;
        break;
      case "ArrowRight":
        nextIndex = activeIndex >= tabs.length - 1 ? 0 : activeIndex + 1;
        break;
      case "Home":
        nextIndex = 0;
        break;
      default:
        nextIndex = tabs.length - 1;
    }
    const next = tabs[nextIndex];
    if (!next) return;
    event.preventDefault();
    next.focus();
    next.click();
  }

  return (
    <TabListContext value={triggerLayout}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={handleKeyDown}
        className="flex border-b border-stroke-neutral-weak"
      >
        {children}
      </div>
    </TabListContext>
  );
}

const triggerClass =
  "h-11 px-x4 text-t5 font-bold -mb-px border-b-2 transition-colors duration-100 ease-standard focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-stroke-focus-ring";

const triggerStates = {
  selected: "text-fg-neutral border-stroke-brand",
  unselected: "text-fg-neutral-subtle border-transparent hover:text-fg-neutral",
  disabled: "text-fg-disabled border-transparent pointer-events-none",
};

export type TabTriggerProps = {
  value: string;
  children: ReactNode;
  disabled?: boolean;
};

export function TabTrigger({
  value,
  children,
  disabled = false,
}: TabTriggerProps) {
  const { value: selectedValue, setValue, idPrefix } = useTabsContext();
  const layout = use(TabListContext);
  const selected = selectedValue === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${idPrefix}-${value}-tab`}
      aria-selected={selected}
      aria-controls={`${idPrefix}-${value}-panel`}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={() => setValue(value)}
      className={cn(
        triggerClass,
        layout === "fill" && "flex-1",
        disabled
          ? triggerStates.disabled
          : selected
            ? triggerStates.selected
            : triggerStates.unselected,
      )}
    >
      {children}
    </button>
  );
}

export type TabContentProps = {
  value: string;
  children: ReactNode;
  className?: string;
};

export function TabContent({ value, children, className }: TabContentProps) {
  const { value: selectedValue, idPrefix } = useTabsContext();
  if (selectedValue !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-${value}-panel`}
      aria-labelledby={`${idPrefix}-${value}-tab`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: 탭패널은 ARIA APG 규격상 키보드 포커스 대상(내부 포커스 요소가 없을 때 스크롤·읽기 진입점)
      tabIndex={0}
      className={className}
    >
      {children}
    </div>
  );
}

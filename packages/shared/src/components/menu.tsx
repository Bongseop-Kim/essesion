import type {
  ComponentPropsWithRef,
  KeyboardEvent,
  ReactNode,
  RefObject,
} from "react";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useId,
  useRef,
} from "react";

import { cn } from "../cn";
import { useControllableState } from "./internal/use-controllable-state";
import { VStack } from "./stack";
import { Text } from "./text";

type MenuContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  contentId: string;
};

const MenuContext = createContext<MenuContextValue | null>(null);

function useMenuContext() {
  const ctx = use(MenuContext);
  if (ctx === null) {
    throw new Error("Menu 하위 컴포넌트는 <Menu> 안에서만 사용할 수 있습니다.");
  }
  return ctx;
}

export type MenuProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
};

/** 드롭다운 메뉴 — 의존성 0, 네이티브 Popover API 기반.
    Trigger·Content·Item·Group·Separator를 컴포지션으로 조합. */
export function Menu({
  open,
  defaultOpen = false,
  onOpenChange,
  children,
}: MenuProps) {
  const [isOpen, setOpen] = useControllableState({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentId = useId();

  return (
    <MenuContext value={{ open: isOpen, setOpen, triggerRef, contentId }}>
      {children}
    </MenuContext>
  );
}

export type MenuTriggerProps = Omit<
  ComponentPropsWithRef<"button">,
  "aria-haspopup" | "aria-expanded" | "children"
> & {
  children: ReactNode;
};

/** 메뉴를 여는 버튼 — ActionButton neutralOutline와 동일한 기본 룩.
    popoverTarget 대신 onClick으로 토글해 controlled 상태와 일관성 유지. */
export function MenuTrigger({
  children,
  className,
  type = "button",
  onClick,
  ref,
  ...props
}: MenuTriggerProps) {
  const { open, setOpen, triggerRef, contentId } = useMenuContext();

  const mergeRef = (node: HTMLButtonElement | null) => {
    triggerRef.current = node;
    if (typeof ref === "function") {
      ref(node);
    } else if (ref) {
      ref.current = node;
    }
  };

  return (
    <button
      type={type}
      ref={mergeRef}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={contentId}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          setOpen(!open);
        }
      }}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-bold transition-colors duration-100 ease-standard",
        "h-10 rounded-r2 px-x4 text-t4",
        "border border-stroke-neutral bg-bg-layer-default text-fg-neutral hover:bg-bg-neutral-weak active:bg-bg-neutral-weak-pressed",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export type MenuContentProps = {
  children: ReactNode;
  className?: string;
};

/** 떠 있는 메뉴 면 — popover=auto로 top-layer에 렌더, 트리거 기준 fixed 좌표 계산. */
export function MenuContent({ children, className }: MenuContentProps) {
  const { open, setOpen, triggerRef, contentId } = useMenuContext();
  const contentRef = useRef<HTMLDivElement | null>(null);

  const reposition = useCallback(() => {
    const content = contentRef.current;
    const trigger = triggerRef.current;
    if (!content || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const contentW = content.offsetWidth;
    const contentH = content.offsetHeight;
    let top = rect.bottom + 4;
    // 아래로 넘치고 위에 공간이 있으면 위로 플립
    if (top + contentH > window.innerHeight && rect.top - contentH - 4 >= 0) {
      top = rect.top - contentH - 4;
    }
    const left = Math.max(
      8,
      Math.min(rect.left, window.innerWidth - contentW - 8),
    );
    content.style.top = `${top}px`;
    content.style.left = `${left}px`;
  }, [triggerRef]);

  // showPopover/hidePopover 동기화 + 열릴 때 포지셔닝·첫 항목 포커스·리스너
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    if (!open) {
      try {
        content.hidePopover();
      } catch {
        // 이미 닫혀 있으면 무시
      }
      return;
    }
    try {
      content.showPopover();
    } catch {
      // 이미 열려 있으면 무시
    }
    reposition();
    const first = content.querySelector<HTMLElement>(
      '[role="menuitem"]:not([disabled])',
    );
    first?.focus();
    const onViewportChange = () => reposition();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, reposition]);

  // 네이티브 light-dismiss/Esc → 상태 동기화, 메뉴 안에 포커스가 있었으면 트리거로 복원
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState !== "closed") return;
      const active = document.activeElement;
      const focusWasInside =
        !active || active === document.body || content.contains(active);
      setOpen(false);
      if (focusWasInside) {
        triggerRef.current?.focus();
      }
    };
    content.addEventListener("toggle", onToggle);
    return () => content.removeEventListener("toggle", onToggle);
  }, [setOpen, triggerRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const content = contentRef.current;
    if (!content) return;
    const items = Array.from(
      content.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled])',
      ),
    );
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(currentIndex + 1) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  return (
    <div
      ref={contentRef}
      id={contentId}
      role="menu"
      popover="auto"
      onKeyDown={onKeyDown}
      className={cn(
        // seed 기하: 패널 r5, 항목 하이라이트는 좌우 x2 인셋(px-x2) — 항목 px-x2와 합쳐 텍스트는 가장자리에서 x4.
        // 주의: 이 요소에 display 클래스(flex 등) 금지 — UA의 [popover] display:none을 덮어써 항상 보이게 됨
        "fixed m-0 min-w-60 rounded-r5 border border-stroke-neutral-weak bg-bg-layer-floating px-x2 py-x2 shadow-s2",
        className,
      )}
    >
      {/* gap-x0_5: 인접 항목의 하이라이트(포커스+호버)가 맞붙지 않게 2px 분리 */}
      <VStack gap="x0_5">{children}</VStack>
    </div>
  );
}

export type MenuItemProps = Omit<
  ComponentPropsWithRef<"button">,
  "onSelect"
> & {
  tone?: "neutral" | "critical";
  onSelect?: () => void;
};

/** 메뉴 항목 — 선택 시 onSelect 후 메뉴를 닫는다. */
export function MenuItem({
  tone = "neutral",
  onSelect,
  className,
  type = "button",
  onClick,
  children,
  ...props
}: MenuItemProps) {
  const { setOpen } = useMenuContext();

  return (
    <button
      type={type}
      role="menuitem"
      tabIndex={-1}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        onSelect?.();
        setOpen(false);
      }}
      className={cn(
        "flex w-full items-center gap-x2 rounded-r3 px-x2 py-x3 text-left text-t4 outline-none transition-colors duration-100 ease-standard hover:bg-bg-neutral-weak focus:bg-bg-neutral-weak disabled:text-fg-disabled",
        tone === "critical" && "text-fg-critical",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export type MenuGroupProps = {
  label?: ReactNode;
  children: ReactNode;
};

/** 항목 묶음 — 선택적 라벨을 위에 둔다. */
export function MenuGroup({ label, children }: MenuGroupProps) {
  return (
    <VStack
      role="group"
      gap="x0_5"
      aria-label={typeof label === "string" ? label : undefined}
    >
      {label != null && (
        <Text
          as="div"
          px="x2"
          py="x1"
          textStyle="captionSm"
          color="fg.neutral-subtle"
        >
          {label}
        </Text>
      )}
      {children}
    </VStack>
  );
}

/** 항목 구분선 — <hr>의 암묵 role="separator". */
export function MenuSeparator() {
  return <hr className="mx-x2 my-x1 h-px border-0 bg-stroke-neutral-weak" />;
}

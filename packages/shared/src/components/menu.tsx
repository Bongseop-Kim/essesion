import {
  type ComponentPropsWithRef,
  cloneElement,
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { cn } from "../cn";
import {
  type AnchoredPlacement,
  type AnchoredPosition,
  positionAnchored,
} from "./internal/anchored-position";
import { CheckGlyph } from "./internal/glyphs";
import { useControllableState } from "./internal/use-controllable-state";
import { VStack } from "./stack";
import { Text } from "./text";

type MenuContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: RefObject<HTMLElement | null>;
  contentId: string;
  placement: AnchoredPlacement;
  gutter: number;
};

const MenuContext = createContext<MenuContextValue | null>(null);

function useMenuContext() {
  const ctx = use(MenuContext);
  if (ctx === null) {
    throw new Error(
      "Menu 하위 컴포넌트는 <MenuRoot> 안에서만 사용할 수 있습니다.",
    );
  }
  return ctx;
}

export type MenuRootProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** MenuTrigger 기준 배치. */
  placement?: AnchoredPlacement;
  /** 앵커와 메뉴 면 사이 간격(px). */
  gutter?: number;
  children: ReactNode;
};

/** 앵커드 메뉴 — 의존성 0, 네이티브 Popover API 기반. */
export function MenuRoot({
  open,
  defaultOpen = false,
  onOpenChange,
  placement = "bottom",
  gutter = 4,
  children,
}: MenuRootProps) {
  const [isOpen, setOpen] = useControllableState({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  const triggerRef = useRef<HTMLElement | null>(null);
  const contentId = useId();

  return (
    <MenuContext
      value={{
        open: isOpen,
        setOpen,
        triggerRef,
        contentId,
        placement,
        gutter,
      }}
    >
      {children}
    </MenuContext>
  );
}

type TriggerElementProps = ComponentPropsWithRef<"button">;

export type MenuTriggerProps = {
  /** 트리거가 될 단일 엘리먼트 — 룩은 자식이 소유하고, 여기서는 ref·aria·onClick만 배선한다. */
  children: ReactElement<TriggerElementProps>;
  ref?: Ref<HTMLElement>;
};

/** 자식 엘리먼트를 메뉴 트리거로 배선 — aria-haspopup/expanded/controls + 클릭 토글. */
export function MenuTrigger({ children, ref }: MenuTriggerProps) {
  const { open, setOpen, triggerRef, contentId } = useMenuContext();

  const childProps = children.props;
  const mergeRef = (node: HTMLElement | null) => {
    triggerRef.current = node;
    setRef(childProps.ref as Ref<HTMLElement> | undefined, node);
    setRef(ref, node);
  };

  return cloneElement(children, {
    ref: mergeRef as Ref<HTMLButtonElement>,
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": contentId,
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      childProps.onClick?.(event);
      if (!event.defaultPrevented) setOpen(!open);
    },
  });
}

export type MenuContentProps = Omit<
  ComponentPropsWithRef<"div">,
  "id" | "popover" | "role"
>;

/** 떠 있는 메뉴 면 — popover=auto로 top-layer에 렌더, 앵커 기준 fixed 좌표(flip·slide). */
export function MenuContent({
  children,
  className,
  style,
  onToggle,
  onKeyDown,
  ref,
  ...props
}: MenuContentProps) {
  const { open, setOpen, triggerRef, contentId, placement, gutter } =
    useMenuContext();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<AnchoredPosition | null>(null);

  const mergeRef = (node: HTMLDivElement | null) => {
    contentRef.current = node;
    setRef(ref, node);
  };

  const updatePosition = useCallback(() => {
    const reference = triggerRef.current;
    const content = contentRef.current;
    if (!reference || !content) return;
    const rect = reference.getBoundingClientRect();
    setPosition(
      positionAnchored(
        {
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        },
        { width: content.offsetWidth, height: content.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        { placement, gutter, overflowPadding: 8 },
      ),
    );
  }, [triggerRef, placement, gutter]);

  // showPopover/hidePopover 동기화 + 열릴 때 포지셔닝·첫 항목 포커스·리스너
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    if (!open) {
      setPosition(null);
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
    const first = content.querySelector<HTMLElement>(
      '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled])',
    );
    // Native Popover may restore trigger focus at the end of the opening task.
    // Position and move focus once the menu has entered the top layer.
    const frame = requestAnimationFrame(() => {
      updatePosition();
      first?.focus();
    });
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const content = contentRef.current;
    if (!content) return;
    const items = Array.from(
      content.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled])',
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
      {...props}
      ref={mergeRef}
      id={contentId}
      role="menu"
      popover="auto"
      onKeyDown={handleKeyDown}
      // 네이티브 light-dismiss/Esc → 상태 동기화, 메뉴 안에 포커스가 있었으면 트리거로 복원
      onToggle={(event) => {
        onToggle?.(event);
        if (event.defaultPrevented) return;
        if ((event.nativeEvent as ToggleEvent).newState === "open") {
          requestAnimationFrame(() => {
            contentRef.current
              ?.querySelector<HTMLElement>(
                '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled])',
              )
              ?.focus();
          });
          return;
        }
        const active = document.activeElement;
        const focusWasInside =
          !active ||
          active === document.body ||
          contentRef.current?.contains(active);
        setOpen(false);
        if (focusWasInside) triggerRef.current?.focus();
      }}
      className={cn(
        // seed 기하: 패널 r5, 항목 하이라이트는 좌우 x2 인셋(px-x2) — 항목 px-x2와 합쳐 텍스트는 가장자리에서 x4.
        // 주의: 이 요소에 display 클래스(flex 등) 금지 — UA의 [popover] display:none을 덮어써 항상 보이게 됨
        "fixed m-0 min-w-60 rounded-r5 border border-stroke-neutral-weak bg-bg-layer-floating px-x2 py-x2 shadow-s2",
        position == null && "invisible",
        className,
      )}
      style={{
        ...style,
        top: position?.top ?? 0,
        left: position?.left ?? 0,
      }}
    >
      {/* gap-x0_5: 인접 항목의 하이라이트(포커스+호버)가 맞붙지 않게 2px 분리 */}
      <VStack gap="x0_5" alignItems="stretch">
        {children}
      </VStack>
    </div>
  );
}

export type MenuItemProps = Omit<
  ComponentPropsWithRef<"button">,
  "children"
> & {
  label: ReactNode;
  description?: ReactNode;
  prefixIcon?: ReactNode;
  suffixIcon?: ReactNode;
  /** 선택 메뉴 항목. 지정하면 menuitemradio/aria-checked로 노출한다. */
  checked?: boolean;
  tone?: "neutral" | "critical";
};

/** 메뉴 항목 — 클릭 시 onClick 후 메뉴를 닫는다(preventDefault로 유지 가능). */
export function MenuItem({
  label,
  description,
  prefixIcon,
  suffixIcon,
  checked,
  tone = "neutral",
  className,
  type = "button",
  onClick,
  ...props
}: MenuItemProps) {
  const { setOpen } = useMenuContext();
  const selectionProps =
    checked === undefined
      ? ({ role: "menuitem" } as const)
      : ({ role: "menuitemradio", "aria-checked": checked } as const);

  return (
    <button
      type={type}
      {...selectionProps}
      tabIndex={-1}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        setOpen(false);
      }}
      className={cn(
        "flex w-full items-center gap-x2 rounded-r3 px-x2 py-x3 text-left text-t4 outline-none transition-colors duration-100 ease-standard hover:bg-bg-neutral-weak focus:bg-bg-neutral-weak disabled:text-fg-disabled",
        tone === "critical" && "text-fg-critical",
        className,
      )}
      {...props}
    >
      {prefixIcon}
      <VStack gap="x0_5" alignItems="stretch" minWidth={0} flex={1}>
        <span className="truncate">{label}</span>
        {description != null ? (
          <Text as="span" textStyle="caption" color="fg.neutral-subtle">
            {description}
          </Text>
        ) : null}
      </VStack>
      {suffixIcon ??
        (checked ? <CheckGlyph aria-hidden className="size-4" /> : null)}
    </button>
  );
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

import {
  type ComponentPropsWithRef,
  type CSSProperties,
  cloneElement,
  createContext,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  use,
  useId,
  useRef,
} from "react";

import { cn } from "../cn";
import { CheckGlyph } from "./internal/glyphs";
import { mergeRefs } from "./internal/merge-refs";
import { VStack } from "./stack";

export type AnchoredPlacement = "top" | "bottom";

type MenuContextValue = {
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
  /** MenuTrigger 기준 배치. */
  placement?: AnchoredPlacement;
  /** 앵커와 메뉴 면 사이 간격(px). */
  gutter?: number;
  children: ReactNode;
};

/** 앵커드 메뉴 — 의존성 0, 네이티브 Popover API 기반. */
export function MenuRoot({
  placement = "bottom",
  gutter = 4,
  children,
}: MenuRootProps) {
  const contentId = useId();

  return (
    <MenuContext value={{ contentId, placement, gutter }}>
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
  const { contentId } = useMenuContext();

  const childProps = children.props;
  const mergeRef = mergeRefs(
    childProps.ref as Ref<HTMLElement> | undefined,
    ref,
  );

  return cloneElement(children, {
    ref: mergeRef as Ref<HTMLButtonElement>,
    "aria-haspopup": "menu",
    "aria-controls": contentId,
    popoverTarget: contentId,
  });
}

export type MenuContentProps = Omit<
  ComponentPropsWithRef<"div">,
  "id" | "popover" | "role"
>;

type AnchorStyle = CSSProperties & {
  positionArea: AnchoredPlacement;
  positionTryFallbacks: string;
};

/** 떠 있는 메뉴 면 — 네이티브 popover와 CSS anchor positioning을 사용한다. */
export function MenuContent({
  children,
  className,
  style,
  onToggle,
  onKeyDown,
  ref,
  ...props
}: MenuContentProps) {
  const { contentId, placement, gutter } = useMenuContext();
  const contentRef = useRef<HTMLDivElement | null>(null);

  const mergeRef = mergeRefs(contentRef, ref);

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
        }
      }}
      className={cn(
        // seed 기하: 패널 r5, 항목 하이라이트는 좌우 x2 인셋(px-x2) — 항목 px-x2와 합쳐 텍스트는 가장자리에서 x4.
        // 주의: 이 요소에 display 클래스(flex 등) 금지 — UA의 [popover] display:none을 덮어써 항상 보이게 됨
        "fixed m-0 min-w-60 rounded-r5 border border-stroke-neutral-weak bg-bg-layer-floating px-x2 py-x2 shadow-s2",
        className,
      )}
      style={
        {
          ...style,
          positionArea: placement,
          positionTryFallbacks: "flip-block",
          margin: gutter,
        } as AnchorStyle
      }
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
  /** 라벨 아래 한 줄 보조 문구 — 항목이 무엇을 하는지 설명한다. */
  description?: ReactNode;
  prefixIcon?: ReactNode;
  /** 선택 메뉴 항목. 지정하면 menuitemradio/aria-checked로 노출한다. */
  checked?: boolean;
};

/** 메뉴 항목 — 클릭 시 onClick 후 메뉴를 닫는다(preventDefault로 유지 가능). */
export function MenuItem({
  label,
  description,
  prefixIcon,
  checked,
  className,
  type = "button",
  onClick,
  ...props
}: MenuItemProps) {
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
        event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover?.();
      }}
      className={cn(
        "flex w-full items-center gap-x2 rounded-r3 px-x2 py-x3 text-left text-t4 outline-none transition-colors duration-(--duration-fast) ease-standard hover:bg-bg-neutral-weak focus:bg-bg-neutral-weak disabled:text-fg-disabled",
        className,
      )}
      {...props}
    >
      {prefixIcon}
      <VStack gap="x0_5" alignItems="stretch" minWidth={0} flex={1}>
        <span className="truncate">{label}</span>
        {description != null && (
          <span className="truncate text-t2 text-fg-neutral-subtle">
            {description}
          </span>
        )}
      </VStack>
      {checked ? <CheckGlyph aria-hidden className="size-4" /> : null}
    </button>
  );
}

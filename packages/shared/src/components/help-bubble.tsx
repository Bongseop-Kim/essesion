import {
  type ComponentPropsWithRef,
  cloneElement,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { cn } from "../cn";
import { Flex } from "./flex";
import { XGlyph } from "./internal/glyphs";
import {
  HELP_BUBBLE_ARROW_HEIGHT,
  HELP_BUBBLE_ARROW_WIDTH,
  type HelpBubblePlacement,
  type HelpBubblePosition,
  positionHelpBubble,
} from "./internal/help-bubble-position";
import { useControllableState } from "./internal/use-controllable-state";
import { VStack } from "./stack";
import { Text } from "./text";

type TriggerElementProps = ComponentPropsWithRef<"button">;

export type HelpBubbleContentProps = Omit<
  ComponentPropsWithRef<"div">,
  "children" | "id" | "popover" | "role"
>;

export type HelpBubbleTriggerProps = {
  title: ReactNode;
  description?: ReactNode;
  showCloseButton?: boolean;
  children: ReactElement<TriggerElementProps>;
  contentProps?: HelpBubbleContentProps;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  closeOnInteractOutside?: boolean;
  placement?: HelpBubblePlacement;
  gutter?: number;
  overflowPadding?: number;
  arrowPadding?: number;
  flip?: boolean | HelpBubblePlacement[];
  slide?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

/** 클릭으로 여는 보조 설명 팝오버. 네이티브 Popover top-layer를 사용한다. */
export function HelpBubbleTrigger({
  title,
  description,
  showCloseButton = false,
  children,
  contentProps,
  open,
  defaultOpen = false,
  onOpenChange,
  closeOnInteractOutside = true,
  placement = "top",
  gutter = 4,
  overflowPadding = 16,
  arrowPadding = 14,
  flip = true,
  slide = true,
  ref,
}: HelpBubbleTriggerProps) {
  const [isOpen, setOpen] = useControllableState({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<HelpBubblePosition | null>(null);
  const generatedId = useId();
  const contentId = `${generatedId}-help-bubble`;
  const titleId = `${generatedId}-help-bubble-title`;
  const descriptionId = `${generatedId}-help-bubble-description`;

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const content = contentRef.current;
    if (!trigger || !content) return;
    const rect = trigger.getBoundingClientRect();
    setPosition(
      positionHelpBubble(
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
        {
          placement,
          gutter,
          overflowPadding,
          arrowPadding,
          flip,
          slide,
        },
      ),
    );
  }, [arrowPadding, flip, gutter, overflowPadding, placement, slide]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    if (!isOpen) {
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
    const frame = requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen || closeOnInteractOutside) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeOnInteractOutside, isOpen, setOpen]);

  const childProps = children.props;
  const mergeTriggerRef = (node: HTMLButtonElement | null) => {
    triggerRef.current = node;
    setRef(childProps.ref, node);
    setRef(ref, node);
  };
  const trigger = cloneElement(children, {
    ref: mergeTriggerRef,
    "aria-haspopup": "dialog",
    "aria-expanded": isOpen,
    "aria-controls": contentId,
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      childProps.onClick?.(event);
      if (!event.defaultPrevented) setOpen(!isOpen);
    },
  });

  const {
    className: contentClassName,
    style: contentStyle,
    ref: contentPropRef,
    onToggle,
    ...otherContentProps
  } = contentProps ?? {};
  const mergeContentRef = (node: HTMLDivElement | null) => {
    contentRef.current = node;
    setRef(contentPropRef, node);
  };

  return (
    <>
      {trigger}
      <div
        {...otherContentProps}
        ref={mergeContentRef}
        id={contentId}
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={description == null ? undefined : descriptionId}
        popover={closeOnInteractOutside ? "auto" : "manual"}
        onToggle={(event) => {
          onToggle?.(event);
          if (event.defaultPrevented) return;
          if ((event.nativeEvent as ToggleEvent).newState !== "closed") return;
          const active = document.activeElement;
          const focusWasInside =
            !active ||
            active === document.body ||
            contentRef.current?.contains(active);
          setOpen(false);
          if (focusWasInside) triggerRef.current?.focus();
        }}
        className={cn(
          "fixed m-0 overflow-visible rounded-r3 bg-bg-neutral-inverted text-fg-contrast shadow-s2",
          "transition ease-enter starting:scale-90 starting:opacity-0 motion-reduce:transition-none",
          position == null && "invisible",
          contentClassName,
        )}
        style={{
          transitionDuration: "var(--duration-normal)",
          ...contentStyle,
          top: position?.top ?? 0,
          left: position?.left ?? 0,
          transformOrigin: transformOrigin(position?.side),
        }}
      >
        {position ? <HelpBubbleArrow position={position} /> : null}
        <Flex align="flex-start" px="x3" py="x2_5">
          <VStack gap="x0_5" alignItems="stretch" minWidth={0} flex={1}>
            <Text id={titleId} textStyle="labelSm" color="fg.contrast">
              {title}
            </Text>
            {description != null ? (
              <Text
                id={descriptionId}
                as="div"
                textStyle="caption"
                color="fg.contrast"
                className="whitespace-pre-wrap"
              >
                {description}
              </Text>
            ) : null}
          </VStack>
          {showCloseButton ? (
            <Flex
              as="button"
              type="button"
              aria-label="닫기"
              align="center"
              justify="center"
              width={38}
              height={38}
              flexShrink
              ml="x1"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="rounded-r3 text-fg-contrast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
            >
              <XGlyph width={14} height={14} />
            </Flex>
          ) : null}
        </Flex>
      </div>
    </>
  );
}

function HelpBubbleArrow({ position }: { position: HelpBubblePosition }) {
  const horizontal = position.side === "top" || position.side === "bottom";
  const width = horizontal ? HELP_BUBBLE_ARROW_WIDTH : HELP_BUBBLE_ARROW_HEIGHT;
  const height = horizontal
    ? HELP_BUBBLE_ARROW_HEIGHT
    : HELP_BUBBLE_ARROW_WIDTH;
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="absolute fill-bg-neutral-inverted"
      style={arrowStyle(position)}
    >
      <path d={arrowPath(position.side)} />
    </svg>
  );
}

function arrowPath(side: HelpBubblePosition["side"]) {
  if (side === "top") return "M0 0 H12 L6 8 Z";
  if (side === "bottom") return "M6 0 L12 8 H0 Z";
  if (side === "left") return "M0 0 V12 L8 6 Z";
  return "M8 0 V12 L0 6 Z";
}

function arrowStyle(position: HelpBubblePosition) {
  if (position.side === "top") {
    return { left: position.arrowX, top: "calc(100% - 1px)" };
  }
  if (position.side === "bottom") {
    return { left: position.arrowX, top: -HELP_BUBBLE_ARROW_HEIGHT + 1 };
  }
  if (position.side === "left") {
    return { left: "calc(100% - 1px)", top: position.arrowY };
  }
  return { left: -HELP_BUBBLE_ARROW_HEIGHT + 1, top: position.arrowY };
}

function transformOrigin(side: HelpBubblePosition["side"] | undefined) {
  if (side === "top") return "bottom";
  if (side === "bottom") return "top";
  if (side === "left") return "right";
  if (side === "right") return "left";
  return "center";
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

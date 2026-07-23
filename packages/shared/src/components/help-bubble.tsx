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
import {
  type AnchoredPlacement,
  type AnchoredPosition,
  positionAnchored,
} from "./internal/anchored-position";
import { mergeRefs } from "./internal/merge-refs";
import { useControllableState } from "./internal/use-controllable-state";
import { VStack } from "./stack";
import { Text } from "./text";

const HELP_BUBBLE_ARROW_WIDTH = 12;
const HELP_BUBBLE_ARROW_HEIGHT = 8;

type TriggerElementProps = ComponentPropsWithRef<"button">;

export type HelpBubbleContentProps = Omit<
  ComponentPropsWithRef<"div">,
  "children" | "id" | "popover" | "role"
>;

export type HelpBubbleTriggerProps = {
  title: ReactNode;
  description?: ReactNode;
  children: ReactElement<TriggerElementProps>;
  contentProps?: HelpBubbleContentProps;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: AnchoredPlacement;
  gutter?: number;
  overflowPadding?: number;
  arrowPadding?: number;
  ref?: Ref<HTMLButtonElement>;
};

/** 클릭으로 여는 보조 설명 팝오버. 네이티브 Popover top-layer를 사용한다. */
export function HelpBubbleTrigger({
  title,
  description,
  children,
  contentProps,
  open,
  defaultOpen = false,
  onOpenChange,
  placement = "top",
  gutter = 4,
  overflowPadding = 16,
  arrowPadding = 14,
  ref,
}: HelpBubbleTriggerProps) {
  const [isOpen, setOpen] = useControllableState({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<AnchoredPosition | null>(null);
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
        {
          placement,
          gutter,
          overflowPadding,
          arrow: {
            width: HELP_BUBBLE_ARROW_WIDTH,
            height: HELP_BUBBLE_ARROW_HEIGHT,
            padding: arrowPadding,
          },
        },
      ),
    );
  }, [arrowPadding, gutter, overflowPadding, placement]);

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

  const childProps = children.props;
  const mergeTriggerRef = mergeRefs(triggerRef, childProps.ref, ref);
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
  const mergeContentRef = mergeRefs(contentRef, contentPropRef);

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
        popover="auto"
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
        </Flex>
      </div>
    </>
  );
}

function HelpBubbleArrow({ position }: { position: AnchoredPosition }) {
  return (
    <svg
      aria-hidden="true"
      width={HELP_BUBBLE_ARROW_WIDTH}
      height={HELP_BUBBLE_ARROW_HEIGHT}
      viewBox={`0 0 ${HELP_BUBBLE_ARROW_WIDTH} ${HELP_BUBBLE_ARROW_HEIGHT}`}
      className="absolute fill-bg-neutral-inverted"
      style={arrowStyle(position)}
    >
      <path d={arrowPath(position.side)} />
    </svg>
  );
}

function arrowPath(side: AnchoredPosition["side"]) {
  if (side === "top") return "M0 0 H12 L6 8 Z";
  return "M6 0 L12 8 H0 Z";
}

function arrowStyle(position: AnchoredPosition) {
  if (position.side === "top") {
    return { left: position.arrowX, top: "calc(100% - 1px)" };
  }
  return { left: position.arrowX, top: -HELP_BUBBLE_ARROW_HEIGHT + 1 };
}

function transformOrigin(side: AnchoredPosition["side"] | undefined) {
  if (side === "top") return "bottom";
  if (side === "bottom") return "top";
  return "center";
}

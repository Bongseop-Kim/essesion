import {
  type ComponentPropsWithRef,
  type CSSProperties,
  cloneElement,
  type ReactElement,
  type ReactNode,
  type Ref,
  useId,
} from "react";

import { cn } from "../cn";
import { Flex } from "./flex";
import { mergeRefs } from "./internal/merge-refs";
import type { AnchoredPlacement } from "./menu";
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
  children: ReactElement<TriggerElementProps>;
  contentProps?: HelpBubbleContentProps;
  placement?: AnchoredPlacement;
  gutter?: number;
  ref?: Ref<HTMLButtonElement>;
};

type AnchorStyle = CSSProperties & {
  positionArea: AnchoredPlacement;
  positionTryFallbacks: string;
};

/** 클릭으로 여는 보조 설명 팝오버. 네이티브 Popover top-layer를 사용한다. */
export function HelpBubbleTrigger({
  title,
  description,
  children,
  contentProps,
  placement = "top",
  gutter = 4,
  ref,
}: HelpBubbleTriggerProps) {
  const generatedId = useId();
  const contentId = `${generatedId}-help-bubble`;
  const titleId = `${generatedId}-help-bubble-title`;
  const descriptionId = `${generatedId}-help-bubble-description`;

  const childProps = children.props;
  const trigger = cloneElement(children, {
    ref: mergeRefs(childProps.ref, ref),
    "aria-haspopup": "dialog",
    "aria-controls": contentId,
    popoverTarget: contentId,
  });

  const {
    className: contentClassName,
    style: contentStyle,
    ...otherContentProps
  } = contentProps ?? {};

  return (
    <>
      {trigger}
      <div
        {...otherContentProps}
        id={contentId}
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={description == null ? undefined : descriptionId}
        popover="auto"
        className={cn(
          "fixed m-0 rounded-r3 bg-bg-neutral-inverted text-fg-contrast shadow-s2",
          "transition ease-enter starting:scale-90 starting:opacity-0 motion-reduce:transition-none",
          contentClassName,
        )}
        style={
          {
            transitionDuration: "var(--duration-normal)",
            ...contentStyle,
            positionArea: placement,
            positionTryFallbacks: "flip-block",
            margin: gutter,
          } as AnchorStyle
        }
      >
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

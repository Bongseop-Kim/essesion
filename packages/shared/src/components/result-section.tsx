import type { ComponentPropsWithRef, ReactNode } from "react";

import { ActionButton, type ActionButtonProps } from "./action-button";
import { VStack } from "./stack";
import { Text } from "./text";

export type ResultSectionProps = Omit<ComponentPropsWithRef<"div">, "title"> & {
  size?: "large" | "medium";
  asset?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  primaryActionProps?: ActionButtonProps;
  secondaryActionProps?: ActionButtonProps;
};

/** 결과·완료·빈 상태 대형 표시 — 에셋·제목·설명·주/보조 액션. */
export function ResultSection({
  size = "large",
  asset,
  title,
  description,
  primaryActionProps,
  secondaryActionProps,
  ...props
}: ResultSectionProps) {
  const large = size === "large";
  const hasText = title !== undefined || description !== undefined;
  const hasAction =
    primaryActionProps !== undefined || secondaryActionProps !== undefined;
  return (
    <VStack
      justify="center"
      align="center"
      px="x12"
      py="x4"
      flexGrow
      {...props}
    >
      {asset}
      {hasText && (
        <VStack
          align="center"
          gap={large ? "x3" : "x2"}
          pb={large ? "x7" : "x6"}
        >
          {title !== undefined && (
            <Text align="center" textStyle={large ? "title2" : "title3"}>
              {title}
            </Text>
          )}
          {description !== undefined && (
            <Text
              align="center"
              color="fg.neutral-muted"
              textStyle={large ? "body" : "bodySm"}
            >
              {description}
            </Text>
          )}
        </VStack>
      )}
      {hasAction && (
        <VStack align="center" gap="x5">
          {primaryActionProps !== undefined && (
            <ActionButton
              variant="neutralWeak"
              size="medium"
              {...primaryActionProps}
            />
          )}
          {secondaryActionProps !== undefined && (
            <ActionButton
              variant="ghost"
              size="small"
              {...secondaryActionProps}
            />
          )}
        </VStack>
      )}
    </VStack>
  );
}

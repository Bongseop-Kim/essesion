import type { ReactNode } from "react";

import { cn } from "../cn";
import { Box } from "./box";
import { Flex } from "./flex";
import { focusRing } from "./internal/focus-ring";
import { Text } from "./text";

type Tone = "neutral" | "informative" | "positive" | "warning" | "critical";

// weak — Callout weak와 동일 매핑(weak 면 위 텍스트는 tone fg).
const weakStyles: Record<Tone, string> = {
  neutral: "bg-bg-neutral-weak text-fg-neutral",
  informative: "bg-bg-informative-weak text-fg-informative",
  positive: "bg-bg-positive-weak text-fg-positive",
  warning: "bg-bg-warning-weak text-fg-warning",
  critical: "bg-bg-critical-weak text-fg-critical",
};

export type PageBannerProps = {
  tone?: Tone;
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
};

/** 페이지 폭 전체를 차지하는 상단/하단 배너 — tone 5종. */
export function PageBanner({
  tone = "neutral",
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: PageBannerProps) {
  return (
    <Flex
      align="center"
      gap="x2"
      width="full"
      minHeight="x10"
      px="x4"
      py="x2_5"
      className={cn(weakStyles[tone], className)}
    >
      {icon !== undefined && (
        <Box as="span" className="shrink-0" aria-hidden="true">
          {icon}
        </Box>
      )}
      <Flex minWidth={0} flex={1} wrap align="baseline" gap="x1_5">
        <Text as="span" textStyle="bodySm" style={{ fontWeight: 700 }}>
          {title}
        </Text>
        {description !== undefined && (
          <Text as="span" textStyle="bodySm">
            {description}
          </Text>
        )}
      </Flex>
      {actionLabel !== undefined && onAction !== undefined && (
        // currentColor 상속 — variant/tone별 fg를 그대로 물려받는다.
        <button
          type="button"
          onClick={onAction}
          className={cn(
            "shrink-0 font-bold text-t3 underline underline-offset-2",
            focusRing,
            "active:opacity-70",
          )}
        >
          {actionLabel}
        </button>
      )}
    </Flex>
  );
}

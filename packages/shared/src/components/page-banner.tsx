import type { ReactNode } from "react";

import { cn } from "../cn";
import { Box } from "./box";
import { Flex } from "./flex";
import { XGlyph } from "./internal/glyphs";
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

const solidStyles: Record<Tone, string> = {
  // neutral×solid → bg.brand-solid 재사용(color-role.md: solid 선택 채움 규칙).
  neutral: "bg-bg-brand-solid text-fg-contrast",
  informative: "bg-bg-informative-solid text-fg-contrast",
  positive: "bg-bg-positive-solid text-fg-contrast",
  // warning×solid → weak 폴백(color-role.md: 노랑 solid + 흰 글자 APCA 미달).
  warning: "bg-bg-warning-weak text-fg-warning",
  critical: "bg-bg-critical-solid text-fg-contrast",
};

const variantStyles: Record<"weak" | "solid", Record<Tone, string>> = {
  weak: weakStyles,
  solid: solidStyles,
};

export type PageBannerProps = {
  variant?: "weak" | "solid";
  tone?: Tone;
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  className?: string;
};

/** 페이지 폭 전체를 차지하는 상단/하단 배너 — variant(weak·solid) × tone 5종. */
export function PageBanner({
  variant = "weak",
  tone = "neutral",
  icon,
  title,
  description,
  actionLabel,
  onAction,
  onDismiss,
  className,
}: PageBannerProps) {
  if (
    process.env.NODE_ENV !== "production" &&
    onDismiss !== undefined &&
    (tone === "warning" || tone === "critical")
  ) {
    console.warn(
      "PageBanner: warning/critical 메시지는 dismissible로 쓰지 마세요.",
    );
  }

  return (
    <Flex
      align="center"
      gap="x2"
      width="full"
      minHeight="x10"
      px="x4"
      py="x2_5"
      className={cn(variantStyles[variant][tone], className)}
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
          className="shrink-0 font-bold text-t3 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring active:opacity-70"
        >
          {actionLabel}
        </button>
      )}
      {onDismiss !== undefined && (
        <Flex
          as="button"
          type="button"
          aria-label="닫기"
          onClick={onDismiss}
          align="center"
          justify="center"
          width={24}
          height={24}
          shrink={0}
          borderRadius="full"
          className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring active:opacity-70"
        >
          <XGlyph className="size-4" />
        </Flex>
      )}
    </Flex>
  );
}

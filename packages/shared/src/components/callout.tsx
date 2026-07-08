import type { ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "../cn";
import { Box } from "./box";
import { Flex } from "./flex";
import { ChevronDownGlyph, XGlyph } from "./internal/glyphs";
import { VStack } from "./stack";
import { Text } from "./text";

type Tone = "neutral" | "informative" | "positive" | "warning" | "critical";

// weak 면(bg.*-weak) — color-role.md: weak 면 위 텍스트는 해당 role의 fg.*.
const toneBg: Record<Tone, string> = {
  neutral: "bg-bg-neutral-weak",
  informative: "bg-bg-informative-weak",
  positive: "bg-bg-positive-weak",
  warning: "bg-bg-warning-weak",
  critical: "bg-bg-critical-weak",
};

// 본문(description·icon) 색 — neutral만 muted로 낮추고 나머지는 tone fg 유지.
const toneBody: Record<Tone, string> = {
  neutral: "text-fg-neutral-muted",
  informative: "text-fg-informative",
  positive: "text-fg-positive",
  warning: "text-fg-warning",
  critical: "text-fg-critical",
};

// 제목 색 — neutral만 강한 fg.neutral, 나머지는 tone fg.
const toneTitle: Record<Tone, string> = {
  neutral: "text-fg-neutral",
  informative: "text-fg-informative",
  positive: "text-fg-positive",
  warning: "text-fg-warning",
  critical: "text-fg-critical",
};

export type CalloutProps = Omit<
  ComponentPropsWithRef<"div">,
  "title" | "onClick"
> & {
  tone?: Tone;
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** actionable — 루트를 button으로 렌더하고 우측에 셰브론을 둔다. */
  onClick?: () => void;
  /** dismissible — 우측에 X 버튼을 둔다. onClick과 동시 사용 시 onClick 우선. */
  onDismiss?: () => void;
};

/** 페이지 내 안내 블록 — tone 5종, actionable(onClick)·dismissible(onDismiss) 지원. */
export function Callout({
  tone = "neutral",
  title,
  description,
  icon,
  onClick,
  onDismiss,
  className,
  children,
  ...rest
}: CalloutProps) {
  const actionable = onClick !== undefined;
  const dismissible = onDismiss !== undefined;
  if (process.env.NODE_ENV !== "production" && actionable && dismissible) {
    console.warn(
      "Callout: onClick과 onDismiss를 함께 지정하면 onClick(actionable)이 우선합니다.",
    );
  }
  if (
    process.env.NODE_ENV !== "production" &&
    dismissible &&
    (tone === "warning" || tone === "critical")
  ) {
    console.warn(
      "Callout: warning/critical 메시지는 dismissible로 쓰지 마세요.",
    );
  }

  const rootClass = cn(
    "text-left",
    toneBg[tone],
    toneBody[tone],
    actionable &&
      "transition-colors duration-100 ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring active:opacity-80",
    className,
  );

  const inner = (
    <>
      {icon !== undefined && (
        // size-4(16px) 아이콘 권장 — 앱 소유 Icon/@heroicons을 슬롯으로 전달.
        <Box as="span" className="shrink-0" aria-hidden="true">
          {icon}
        </Box>
      )}
      <VStack as="span" minWidth={0} flex={1} gap="x0_5">
        {title !== undefined && (
          <Text
            as="span"
            textStyle="bodySm"
            className={toneTitle[tone]}
            style={{ fontWeight: 700 }}
          >
            {title}
          </Text>
        )}
        {description !== undefined && (
          <Text as="span" textStyle="bodySm">
            {description}
          </Text>
        )}
        {children}
      </VStack>
      {actionable ? (
        <ChevronDownGlyph className="size-4 shrink-0 -rotate-90" />
      ) : dismissible ? (
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
          className="transition-colors duration-100 ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring active:opacity-70"
        >
          <XGlyph className="size-4" />
        </Flex>
      ) : null}
    </>
  );

  if (actionable) {
    return (
      <Flex
        as="button"
        type="button"
        onClick={onClick}
        align="flex-start"
        gap="x3"
        width="full"
        minHeight="x13"
        px="x3_5"
        py="x3_5"
        borderRadius="r3"
        className={rootClass}
        {...(rest as ComponentPropsWithRef<"button">)}
      >
        {inner}
      </Flex>
    );
  }
  return (
    <Flex
      align="flex-start"
      gap="x3"
      width="full"
      minHeight="x13"
      px="x3_5"
      py="x3_5"
      borderRadius="r3"
      className={rootClass}
      {...rest}
    >
      {inner}
    </Flex>
  );
}
